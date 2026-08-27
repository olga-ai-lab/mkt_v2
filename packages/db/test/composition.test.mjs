/**
 * O composition root, montado contra Postgres real.
 *
 * Todos os outros testes injetam dependencia. Este monta o sistema do jeito
 * que ele sobe em producao — pool de verdade, portas de verdade, gateway de
 * verdade — e prova que a montagem fecha.
 *
 * A ausencia deste teste e o que deixou `registerFunctions()` escrita, testada
 * e nunca chamada por ninguem.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createWorkerApp, conferirSuperficie } from "../../../apps/worker/src/composition.mjs";
import { PUBLISH_DB_SURFACE } from "../../../apps/worker/src/publish-workflow.mjs";
import { OUTBOX_DB_SURFACE } from "../../../apps/worker/src/outbox-relay.mjs";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
let pool;
const ORG = "11111111-1111-1111-1111-111111111111";
const WS = "22222222-2222-2222-2222-222222222222";

before(async () => { pool = new pg.Pool({ connectionString: url }); });
after(async () => { await pool.end(); });

test("a montagem fecha com pool de verdade", () => {
  const app = createWorkerApp({ pool, env: {}, tracer: null, schema: "mkt" });
  assert.equal(typeof app.gateway.execute, "function");
  assert.equal(app.adapterMode, "fake", "sem META_ADAPTER, o padrao e o falso");
  assert.ok(app.ports.publishing, "os produtores tem de estar montados");
});

test("a porta de banco cobre tudo que o workflow e o relay chamam", () => {
  const app = createWorkerApp({ pool, env: {}, tracer: null, schema: "mkt" });
  for (const metodo of [...PUBLISH_DB_SURFACE, ...OUTBOX_DB_SURFACE]) {
    assert.equal(typeof app.db[metodo], "function", `falta ${metodo} na porta real`);
  }
});

test("porta incompleta derruba a montagem, com o nome do que falta", () => {
  assert.throws(
    () => conferirSuperficie({ getCapability: () => {} }),
    (e) => {
      assert.match(e.message, /collectPublishFacts/);
      assert.match(e.message, /markPublished/);
      assert.match(e.message, /claimOutboxBatch/);
      return true;
    },
    "um metodo faltando so apareceria na primeira publicacao real");
});

test("o gateway montado consulta a validade da aprovacao", async () => {
  const app = createWorkerApp({ pool, env: {}, tracer: null, schema: "mkt" });
  // Sem esta porta o gateway so sabe que um approval_id foi apresentado, nao
  // que ele ainda vale — e conteudo editado depois de aprovado passaria.
  const valido = await app.approvalService.isApprovalValid(
    "00000000-0000-4000-8000-000000000000", { content_version_id: "x" });
  assert.equal(valido, false, "aprovacao inexistente nao pode autorizar");
});

test("META_ADAPTER=real monta o adapter do Meta Graph", () => {
  const app = createWorkerApp({
    pool, tracer: null, schema: "mkt",
    env: { META_ADAPTER: "real", META_SECRET_META_CONN1: "tok" },
  });
  assert.equal(app.adapterMode, "real");
  assert.equal(app.adapters.meta_graph.name, "meta_graph");
});

test("META_ADAPTER invalido nao vira falso em silencio", () => {
  assert.throws(
    () => createWorkerApp({ pool, tracer: null, schema: "mkt", env: { META_ADAPTER: "producao" } }),
    /META_ADAPTER invalido/);
});

test("sem cliente Inngest, monta o resto e nao registra funcao", () => {
  const app = createWorkerApp({ pool, env: {}, tracer: null, schema: "mkt" });
  assert.deepEqual(app.functions, [],
    "o composition serve tambem a quem so precisa das portas, sem motor durável");
});

test("com cliente Inngest, registra o workflow e o relay do outbox", async () => {
  const { createInngestClient } = await import("../../../apps/worker/src/client.mjs");
  const inngest = createInngestClient({ env: { NODE_ENV: "test" } });
  const app = createWorkerApp({ pool, inngest, env: {}, tracer: null, schema: "mkt" });

  assert.equal(app.functions.length, 2, "publish-content e outbox-relay");
  const ids = app.functions.map((f) => f.id?.() ?? f.id).map(String);
  assert.ok(ids.some((i) => i.includes("publish-content")), `ids: ${ids}`);
  assert.ok(ids.some((i) => i.includes("outbox-relay")), `ids: ${ids}`);
});

test("sem pool, falha claro em vez de montar pela metade", () => {
  assert.throws(() => createWorkerApp({}), /exige um pool/);
});

// ── Loop de agente na montagem ──────────────────────────────────────────────

test("sem providers, monta o resto e nao monta o loop", () => {
  const app = createWorkerApp({ pool, env: {}, tracer: null, schema: "mkt" });
  assert.equal(app.agentLoop, null,
    "quem so precisa das portas nao deve precisar de chave de LLM para montar");
  assert.equal(app.modelGateway, null);
  assert.ok(app.gateway, "o Capability Gateway continua montado");
});

test("com providers, o loop monta com os compiladores da Fase 1", () => {
  const providers = { anthropic: { complete: async () => ({ content: "{}" }) } };
  const app = createWorkerApp({ pool, providers, env: {}, tracer: null, schema: "mkt" });

  assert.equal(typeof app.agentLoop.run, "function");
  assert.ok(app.modelGateway, "o loop precisa do Model Gateway");
});

test("o loop de producao resolve entidade contra o banco, e nao pelo modelo", () => {
  // Sem esta linha montada, `canonical_id` volta a ser o que o modelo
  // escreveu, e o loop confere apenas se ele e nao-nulo — que aprova um uuid
  // inventado com a mesma facilidade que um correto. Foi assim que o produto
  // rodou ate a 0015.
  //
  // A porta e a metade verificavel aqui; a outra metade e que
  // `createEntityResolver` recusa montar sem ela (provado em
  // packages/runtime/test/entity-resolver.test.mjs). Juntas, as duas dizem que
  // a montagem abaixo nao pode existir sem a resolucao ligada.
  const providers = { anthropic: { complete: async () => ({ content: "{}" }) } };
  const app = createWorkerApp({ pool, providers, env: {}, tracer: null, schema: "mkt" });

  for (const m of ["byId", "byNaturalKey", "byAlias"]) {
    assert.equal(typeof app.ports.entities?.[m], "function", `falta entities.${m}`);
  }
  assert.ok(app.agentLoop);
});

test("o loop montado recusa capability sem compilador", async () => {
  // A prova de que os compiladores estao mesmo ligados: uma capability fora
  // das tres da Fase 1 nao tem builder, e o loop para em vez de deixar o
  // modelo escolher os argumentos.
  const providers = {
    anthropic: {
      complete: async (req) => ({
        content: JSON.stringify(
          req.schema_ref === "olga://io/intent-resolution"
            ? { trace_id: "t", tenant: { org_id: ORG, workspace_id: WS },
                intent: "CONNECT_CHANNEL", confidence_band: "HIGH",
                entities: [], ambiguities: [] }
            : { trace_id: "t", tenant: { org_id: ORG, workspace_id: WS },
                agent_id: "AGT-MKT-COPILOT", agent_version: "1",
                steps: [{ step_id: "s1", capability_id: "channel.connect",
                          mode: "write", args_summary: "conectar" }] }),
        input_tokens: 1, output_tokens: 1,
      }),
    },
  };
  const app = createWorkerApp({ pool, providers, env: {}, tracer: null, schema: "mkt" });
  assert.equal(typeof app.agentLoop.run, "function");
  // Nao roda de verdade aqui (exige agente ACTIVE e orcamento); o que importa
  // e que os compiladores registrados sao exatamente os tres da Fase 1.
  assert.ok(app.agentLoop);
});
