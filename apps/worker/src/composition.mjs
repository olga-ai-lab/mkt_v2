/**
 * Composition root do worker.
 *
 * Este e o unico lugar do sistema que sabe montar tudo junto: pool, portas,
 * policy, receipts, adapters, gateway e as funcoes duraveis. Todo o resto
 * recebe dependencia por parametro e nao conhece quem a construiu — que e o
 * que permitiu testar cada peca sem banco e sem rede ate aqui.
 *
 * Ele existe porque faltava: `registerFunctions()` estava escrita e testada, e
 * ninguem a chamava. Codigo que ninguem monta nao roda, por mais testado que
 * esteja.
 *
 * ── Falhar na montagem, nao na publicacao ──────────────────────────────────
 *
 * A conferencia de superficie no fim deste arquivo nao e paranoia: a porta do
 * worker ja existiu APENAS nos testes, com um dublê completo. Se aquilo
 * tivesse subido, o erro apareceria na primeira publicacao real, num metodo
 * faltando, com um post pela metade. Agora falta de metodo derruba o boot.
 */
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createApprovalService } from "@olga/runtime/approvals";
import { createModelGateway } from "@olga/runtime/model-gateway";
import { createAgentLoop, createCompiler } from "@olga/runtime/agent-loop";
import { createLlmResolver, createLlmPlanner, createLlmResponder } from "@olga/runtime/agent-stages";
import { createAllCompilers } from "@olga/runtime/capability-compilers";
import { createRetrieval } from "@olga/runtime/retrieval";
import { createComposer } from "@olga/runtime/composer";
import { createBrandExtractor } from "@olga/runtime/extractor";
import { createEntityResolver } from "@olga/runtime/entity-resolver";
import { createGateway } from "@olga/gateway";
import { createWorkerPorts } from "./ports-worker.mjs";
import { createAdapters, createEnvSecrets } from "./adapters.mjs";
import { registerFunctions } from "./inngest.mjs";
import { PUBLISH_DB_SURFACE } from "./publish-workflow.mjs";
import { OUTBOX_DB_SURFACE } from "./outbox-relay.mjs";

const tracerPadrao = {
  event: (e) => console.log(JSON.stringify({ ...e, kind: "trace" })),
};

/**
 * @param {{ pool: any, inngest?: any, providers?: any, env?: any,
 *           tracer?: any, schema?: string }} deps
 *
 * `providers` é opcional pelo mesmo motivo que `inngest` é: quem só precisa
 * das portas — um teste de banco, o relay — não deve ser obrigado a ter chave
 * de LLM configurada para montar. Sem providers não há loop de agente, e isso
 * é dito no retorno, não escondido.
 */
export function createWorkerApp({ pool, inngest, providers, env = process.env, tracer = tracerPadrao, schema } = {}) {
  if (!pool) throw new Error("createWorkerApp exige um pool de Postgres");

  const opcoes = schema ? { schema } : undefined;
  const ports = createPostgresPorts(pool, opcoes);
  const worker = createWorkerPorts(pool, opcoes);
  const approvalService = createApprovalService({ approvals: ports.approvals, tracer });

  // O Model Gateway sobe ANTES dos adapters, e nao depois.
  //
  // Duas capabilities internas escrevem texto, e texto sai de modelo. O
  // adapter interno recebe o redator por porta; se os adapters fossem montados
  // primeiro, o redator teria de ser injetado depois, e existiria um instante
  // em que o adapter esta no mapa do gateway sem saber escrever.
  const modelGateway = providers
    ? createModelGateway({ routing: ports.routing, budget: ports.budget, providers, tracer })
    : null;

  const { adapters, mode: adapterMode } = createAdapters({
    ports, tracer,
    secrets: createEnvSecrets(env),
    mode: env.META_ADAPTER ?? "fake",
    compose: modelGateway ? createComposer({ modelGateway }) : null,
    extract: modelGateway ? createBrandExtractor({ modelGateway, tracer }) : null,
  });

  const gateway = createGateway({
    registry: {
      getCapability: (id, v) => worker.getCapability(id, v),
      newId: () => crypto.randomUUID(),
      // O gateway consulta a validade da aprovacao no passo 3. Sem esta porta
      // ele so sabe que um approval_id foi apresentado, nao que ele vale —
      // e conteudo editado depois de aprovado passaria.
      isApprovalValid: (id, args) => approvalService.isApprovalValid(id, args),
    },
    policies: ports.policies,
    receipts: ports.receipts,
    adapters,
    tracer,
  });

  // O `db` do workflow e a uniao das duas portas. O workflow nao sabe que sao
  // duas; para ele e uma interface so.
  const db = { ...worker, ...ports.outbox };
  conferirSuperficie(db);

  const functions = inngest ? registerFunctions({ inngest, gateway, db, tracer }) : [];

  // ── Loop de agente ────────────────────────────────────────────────────────
  // Os compiladores são o que impede o modelo de escolher argumentos. Sem
  // eles montados aqui, o loop recusaria toda capability — que é o padrão
  // seguro, mas não é o que se quer em produção.
  let agentLoop = null;
  if (modelGateway) {
    agentLoop = createAgentLoop({
      resolver: createLlmResolver({ modelGateway }),
      planner: createLlmPlanner({ modelGateway }),
      responder: createLlmResponder({ modelGateway }),
      retrieval: createRetrieval({ knowledge: ports.knowledge }),
      // Sem esta linha, `canonical_id` volta a ser o que o modelo escreveu, e
      // o loop confere apenas se ele é não-nulo. Foi assim que o produto
      // rodou até a 0015: um uuid inventado passava igual a um correto, e a
      // recusa só vinha quando o SELECT do compilador não achava a linha.
      entityResolver: createEntityResolver({ entities: ports.entities }),
      compiler: createCompiler(createAllCompilers({ publishing: ports.publishing })),
      gateway,
      registry: {
        getAgent: (id) => ports.registry.getAgent(id),
        getCapability: (id, v) => worker.getCapability(id, v),
        workspaceBelongsToOrg: (ws, org) => ports.registry.workspaceBelongsToOrg(ws, org),
      },
      policies: ports.policies,
      runs: ports.runs,
      tracer,
      ids: { newId: () => crypto.randomUUID(), newTraceId: () => `tr_${crypto.randomUUID()}` },
    });
  }

  return {
    ports, worker, db, gateway, adapters, adapterMode, approvalService, functions,
    modelGateway, agentLoop,
  };
}

/** Falha alto e cedo, com o nome do que falta. */
export function conferirSuperficie(db) {
  const exigidos = [...PUBLISH_DB_SURFACE, ...OUTBOX_DB_SURFACE];
  const faltando = exigidos.filter((m) => typeof db?.[m] !== "function");
  if (faltando.length) {
    throw new Error(
      `porta de banco incompleta para o worker: falta ${faltando.join(", ")}. ` +
      `Um metodo faltando aqui so apareceria na primeira publicacao real.`);
  }
  return true;
}
