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
