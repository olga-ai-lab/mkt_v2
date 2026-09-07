/**
 * A leitura do trace, contra o banco de verdade.
 *
 * A Documentacao Mestra pede rastreabilidade do pedido ao efeito. Os dados
 * sempre existiram — cinco tabelas compartilham `trace_id` e ha teste provando
 * que a cadeia liga — mas nao havia como olhar sem escrever SQL a mao sabendo
 * quais eram as cinco. Auditoria que exige saber o schema nao e auditoria
 * disponivel.
 *
 * O que este teste protege, alem da montagem: que a porta nao atravesse
 * organizacao. Uma tela de auditoria que mostrasse trace de outro cliente seria
 * o pior vazamento possivel, porque o trace carrega justamente o que foi feito.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports;
const TRACE = "tr_trace_test";

const limpar = () => db.query(`delete from mkt.organizations where slug in ('trace-a','trace-b')`);

before(async () => {
  await db.connect();
  await limpar();

  for (const [slug, chave] of [["trace-a", "a"], ["trace-b", "b"]]) {
    const r = await db.query(`
      with o as (insert into mkt.organizations (name, slug) values ($1,$1) returning id)
      insert into mkt.workspaces (org_id, name) select id, 'Principal' from o
      returning id as ws, org_id`, [slug]);
    ids[`org_${chave}`] = r.rows[0].org_id;
    ids[`ws_${chave}`] = r.rows[0].ws;
  }

  ports = createPostgresPorts(db, { schema: "mkt" });

  // Um trace com as cinco pontas, na organizacao A.
  await db.query(
    `insert into mkt.agent_runs (org_id, workspace_id, trace_id, agent_id, agent_version,
                                 status, respondability, reason_codes, started_at)
     values ($1,$2,$3,'AGT-MKT-CONTENT',1,'SUCCEEDED','EXECUTABLE','{}', now() - interval '5 seconds')`,
    [ids.org_a, ids.ws_a, TRACE]);
  await ports.audit.record({
    org_id: ids.org_a, workspace_id: ids.ws_a, actor_type: "agent",
    actor_id: "AGT-MKT-CONTENT", action: "agent_run.finished",
    object_type: "agent_run", decision: "SUCCEEDED", trace_id: TRACE,
    payload: { steps: [{ capability_id: "content.create_draft", args_summary: "criar rascunho" }] },
  });
  await db.query(
    `insert into mkt.action_receipts (org_id, workspace_id, capability_id, capability_version,
                                      idempotency_key, provider, external_id, status,
                                      autonomy_used, trace_id)
     values ($1,$2,'publishing.publish',1,'k-trace','meta','ig_9','EFFECTED','A3',$3)`,
    [ids.org_a, ids.ws_a, TRACE]);
  await db.query(
    `insert into mkt.outbox (org_id, workspace_id, event_type, payload, trace_id, published_at)
     values ($1,$2,'olga/content.published','{}'::jsonb,$3, now())`,
    [ids.org_a, ids.ws_a, TRACE]);
  await db.query(
    `insert into mkt.workflow_runs (org_id, workspace_id, workflow_id, trace_id, current_state)
     values ($1,$2,'publish',$3,'PUBLISHED')`,
    [ids.org_a, ids.ws_a, TRACE]);
});

after(async () => { await limpar(); await db.end(); });

test("a linha do tempo junta as cinco fontes, em ordem", async () => {
  const t = await ports.trace.byTraceId(ids.org_a, TRACE);

  assert.equal(t.encontrado, true);
  const fontes = t.eventos.map((e) => e.fonte).sort();
  assert.deepEqual(fontes, ["agent_run", "audit_event", "evento", "receipt", "workflow"].sort());

  const instantes = t.eventos.map((e) => new Date(e.instante).getTime());
  assert.deepEqual(instantes, [...instantes].sort((a, b) => a - b),
    "linha do tempo fora de ordem nao e linha do tempo");
});

test("o efeito externo aparece com o id que o provider devolveu", async () => {
  // A pergunta que distingue auditoria de log: isto aconteceu la fora?
  const t = await ports.trace.byTraceId(ids.org_a, TRACE);
  const receipt = t.eventos.find((e) => e.fonte === "receipt");
  assert.equal(receipt.detalhe.external_id, "ig_9");
  assert.equal(receipt.detalhe.provider, "meta");
  assert.equal(receipt.status, "EFFECTED");
});

test("o plano que o agente propos chega na leitura", async () => {
  const t = await ports.trace.byTraceId(ids.org_a, TRACE);
  const auditoria = t.eventos.find((e) => e.fonte === "audit_event");
  assert.deepEqual(auditoria.detalhe.payload.steps,
    [{ capability_id: "content.create_draft", args_summary: "criar rascunho" }]);
});

test("o trace de uma organizacao nao aparece para outra", async () => {
  const t = await ports.trace.byTraceId(ids.org_b, TRACE);
  assert.equal(t.encontrado, false);
  assert.deepEqual(t.eventos, []);
});

test("trace inexistente devolve vazio, e nao erro", async () => {
  // "Nao achei" e resposta legitima. Levantar aqui obrigaria toda tela a
  // tratar como falha o que e so um id que ninguem reconhece.
  const t = await ports.trace.byTraceId(ids.org_a, "tr_nao_existe");
  assert.equal(t.encontrado, false);
});

test("a listagem traz o trace do workspace, com a contagem de efeitos", async () => {
  const lista = await ports.trace.list(ids.org_a, ids.ws_a, { limit: 10 });
  const meu = lista.find((l) => l.trace_id === TRACE);

  assert.ok(meu, "o trace criado tem de aparecer na listagem do workspace");
  assert.equal(meu.agent_id, "AGT-MKT-CONTENT");
  assert.equal(meu.status, "SUCCEEDED");
  assert.equal(meu.receipts, 1, "quantos efeitos externos aquele pedido produziu");
});

test("a listagem nao atravessa workspace", async () => {
  const lista = await ports.trace.list(ids.org_b, ids.ws_b, { limit: 10 });
  assert.equal(lista.find((l) => l.trace_id === TRACE), undefined);
});
