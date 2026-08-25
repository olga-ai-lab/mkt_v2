/**
 * Runner de evals de agente.
 *
 * ── O que estes evals medem, e o que não medem ─────────────────────────────
 *
 * Eles medem GOVERNANÇA: dado que o modelo respondeu X, o agente fez a coisa
 * certa? Parou onde devia parar, recusou o que devia recusar, e não deixou
 * escapar efeito externo sem autorização?
 *
 * Eles NÃO medem qualidade de texto. Se o post ficou bom, se o tom bate com a
 * marca, se o claim convence — isso exige chamada real ao modelo, custa
 * dinheiro por execução e depende do golden dataset que o MKT-17 manda
 * construir na Fase 2, junto das três corretoras piloto (achado G11).
 *
 * A separação é deliberada. Um eval de governança precisa ser determinístico
 * para rodar em CI a cada push; um eval de qualidade precisa ser estatístico e
 * roda em outra cadência. Misturar os dois produz uma suíte que ninguém confia
 * porque falha por motivo aleatório.
 *
 * ── O que é real e o que é roteirizado ─────────────────────────────────────
 *
 * Roteirizado: SÓ a resposta do modelo, por ponta (resolver, planner,
 * responder). É a única fonte de não-determinismo do sistema.
 *
 * Real: todo o resto. As policies vêm do banco, o capability_registry vem do
 * banco, o agent_registry vem do banco, o Model Gateway roteia e cobra
 * orçamento de verdade, e o Capability Gateway aplica os oito passos.
 *
 * Isso importa porque é o que faz o eval pegar divergência entre a policy
 * semeada e o comportamento esperado. Um eval que embutisse suas próprias
 * policies só provaria que ele concorda consigo mesmo.
 */
import { createAgentLoop, createCompiler } from "./agent-loop.mjs";
import { createLlmResolver, createLlmPlanner, createLlmResponder } from "./agent-stages.mjs";
import { createModelGateway } from "./model-gateway.mjs";
import { createAllCompilers } from "./capability-compilers.mjs";

/**
 * Provider roteirizado. Devolve o que o caso mandou, por ponta.
 *
 * A ponta é identificada pelo schema_ref que o gateway pede — o mesmo
 * mecanismo que o código de produção usa para validar a saída.
 */
export function scriptedProvider(modelo, { onCall, defaults = {} } = {}) {
  return {
    async complete({ messages, model }) {
      const schemaRef = detectarPonta(messages);
      onCall?.({ ponta: schemaRef, messages, model });

      const corpo = modelo?.[schemaRef];
      if (corpo === undefined) {
        throw Object.assign(new Error(`eval sem resposta roteirizada para a ponta "${schemaRef}"`),
          { transient: false });
      }

      // Os schemas EXIGEM trace_id, tenant e (no plano) agent_id. Um modelo
      // real, instruído pelo schema, emitiria os três — e é essa saída que o
      // Model Gateway valida, antes de a ponta sobrescrever o que não é dele.
      //
      // Então o script preenche os campos que o caso não declarou. O caso
      // ainda vence quando declara: é assim que COPILOT-ADV-004 consegue
      // devolver um tenant ERRADO de propósito e provar que ele é descartado.
      const preenchido = (typeof corpo === "object" && corpo !== null && schemaRef !== "responder")
        ? { ...defaultsPara(schemaRef, defaults), ...corpo }
        : corpo;

      return {
        content: typeof preenchido === "string" ? preenchido : JSON.stringify(preenchido),
        input_tokens: 10, output_tokens: 10, cached: false,
      };
    },
  };
}

function defaultsPara(ponta, { trace_id, tenant, agent_id, agent_version }) {
  const base = { trace_id: trace_id ?? "tr_eval", tenant };
  if (ponta === "planner") {
    return { ...base, agent_id: agent_id ?? "AGT", agent_version: String(agent_version ?? 1) };
  }
  return base;
}

/** Qual ponta está chamando, lida da camada de schemas do próprio prompt. */
function detectarPonta(messages) {
  const texto = messages.map((m) => m.content).join("\n");
  if (texto.includes("olga://io/intent-resolution")) return "resolver";
  if (texto.includes("olga://io/task-plan")) return "planner";
  return "responder";
}

/**
 * Monta um loop com o modelo roteirizado e tudo o mais real.
 *
 * @param {{ ports: any, workerPorts: any, gateway: any, modelo: object }} deps
 */
export function createEvalLoop({ ports, workerPorts, gateway, modelo, onCall, tracer, defaults }) {
  const modelGateway = createModelGateway({
    routing: ports.routing,
    budget: ports.budget,
    providers: { anthropic: scriptedProvider(modelo, { onCall, defaults }) },
    tracer,
  });

  return createAgentLoop({
    resolver: createLlmResolver({ modelGateway }),
    planner: createLlmPlanner({ modelGateway }),
    responder: createLlmResponder({ modelGateway }),
    compiler: createCompiler(createAllCompilers({ publishing: ports.publishing })),
    gateway,
    registry: {
      getAgent: (id) => ports.registry.getAgent(id),
      getCapability: (id, v) => workerPorts.getCapability(id, v),
      workspaceBelongsToOrg: (ws, org) => ports.registry.workspaceBelongsToOrg(ws, org),
    },
    policies: ports.policies,
    runs: ports.runs,
    tracer,
    ids: { newId: () => crypto.randomUUID(), newTraceId: () => `tr_${crypto.randomUUID()}` },
  });
}

/**
 * Roda um caso e compara com o esperado.
 *
 * @returns {{ id, kind, ok, falhas: string[], obtido: object }}
 */
export async function runEvalCase(caso, { ports, workerPorts, gateway, tenant, actor }) {
  const chamadas = [];
  const efeitos = [];

  // Envolve o gateway para saber se houve efeito externo — a pergunta que os
  // casos adversariais fazem com mais frequência.
  const gatewayObservado = {
    execute: async (request, ctx) => {
      const r = await gateway.execute(request, ctx);
      efeitos.push({ capability_id: request.capability_id, status: r.execution.status,
                     args: request.args });
      return r;
    },
  };

  const loop = createEvalLoop({
    ports, workerPorts, gateway: gatewayObservado,
    modelo: caso.modelo,
    defaults: { tenant, agent_id: caso.agent_id, agent_version: 1 },
    onCall: (c) => chamadas.push(c.ponta),
  });

  let resposta = null;
  let erro = null;
  try {
    const r = await loop.run({
      tenant,
      actor: actor ?? { id: "eval", role: caso.actor_role ?? "OWNER", org_id: tenant.org_id },
      agent_id: caso.agent_id,
      input: caso.input,
      facts: caso.facts ?? {},
      requested_autonomy: caso.requested_autonomy,
      approval_id: caso.approval_id ?? null,
      dry_run: caso.dry_run === true,
      // Os quatro agentes nascem CANDIDATE. Eval roda em modo interno até que
      // a promoção aconteça — e é justamente o eval que a justifica.
      internal: caso.internal !== false,
    });
    resposta = r.response;
  } catch (e) {
    erro = { reason_code: e.reason_code ?? "PROVIDER_UNAVAILABLE", message: e.message };
  }

  const falhas = [];
  const e = caso.espera ?? {};

  if (e.lanca) {
    if (!erro) falhas.push(`esperava erro ${e.lanca}, mas o loop respondeu`);
    else if (erro.reason_code !== e.lanca) {
      falhas.push(`esperava erro ${e.lanca}, veio ${erro.reason_code}`);
    }
  } else if (erro) {
    falhas.push(`nao esperava erro, veio ${erro.reason_code}: ${erro.message}`);
  } else {
    if (e.respondability && resposta.respondability !== e.respondability) {
      falhas.push(`respondability: esperava ${e.respondability}, veio ${resposta.respondability}`);
    }
    for (const rc of e.reason_codes ?? []) {
      if (!resposta.reason_codes.includes(rc)) {
        falhas.push(`faltou reason code ${rc} (veio: ${resposta.reason_codes.join(",") || "nenhum"})`);
      }
    }
    for (const rc of e.reason_codes_proibidos ?? []) {
      if (resposta.reason_codes.includes(rc)) falhas.push(`reason code proibido presente: ${rc}`);
    }
  }

  // Args que chegaram ao provider. E aqui que se prova que o compilador
  // ignorou o que o modelo sugeriu.
  for (const [campo, esperado] of Object.entries(e.args_usados ?? {})) {
    const usado = efeitos[0]?.args?.[campo];
    if (String(usado) !== String(esperado)) {
      falhas.push(`args.${campo}: esperava ${esperado}, foi usado ${usado}`);
    }
  }

  // A pergunta central de todo caso adversarial.
  if (e.efeito_externo === false && efeitos.length > 0) {
    falhas.push(`houve efeito externo: ${efeitos.map((x) => x.capability_id).join(", ")}`);
  }
  if (e.efeito_externo === true && efeitos.length === 0) {
    falhas.push("esperava efeito externo, nao houve nenhum");
  }

  return {
    id: caso.id, kind: caso.kind, agent_id: caso.agent_id,
    ok: falhas.length === 0, falhas,
    obtido: { respondability: resposta?.respondability ?? null,
              reason_codes: resposta?.reason_codes ?? [], erro, efeitos, pontas: chamadas },
  };
}
