/**
 * O outbox contra Postgres real (T5).
 *
 * O teste em apps/worker/test/outbox-relay.test.mjs prova a POLITICA do relay
 * usando um outbox em memoria. Este aqui prova o SQL: que o claim reserva de
 * verdade, que `for update skip locked` faz dois relays pegarem linhas
 * diferentes, e que o ledger de dedup e mesmo unico por (consumer, event_key).
 *
 * Sem este arquivo, a unica garantia seria a de que a minha imitacao do
 * Postgres esta de acordo comigo mesmo.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const admin = new pg.Client({ connectionString: url });
const ids = {};
let ports;

const limpar = (c) => c.query(`delete from mkt.organizations where slug = 'outbox-test'`);

before(async () => {
  await admin.connect();
  await limpar(admin);
  const r = await admin.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Outbox Test','outbox-test') returning id)
    insert into mkt.workspaces (org_id, name) select o.id, 'Principal' from o returning id, org_id`);
  ids.ws = r.rows[0].id;
  ids.org = r.rows[0].org_id;
  ports = createPostgresPorts(admin, { schema: "mkt" }).outbox;
  await admin.query(`delete from mkt.processed_events where consumer = 'teste-outbox'`);
});

after(async () => {
  await admin.query(`delete from mkt.processed_events where consumer = 'teste-outbox'`);
  await limpar(admin);
  await admin.end();
});

async function enfileirar(event_type, payload, attempts = 0) {
  const { rows } = await admin.query(
    `insert into mkt.outbox (org_id, workspace_id, event_type, payload, trace_id, attempts)
     values ($1,$2,$3,$4::jsonb,$5,$6) returning id`,
    [ids.org, ids.ws, event_type, JSON.stringify(payload), `tr_${event_type}`, attempts]);
  return rows[0].id;
}

test("o claim reserva a linha e ja conta a tentativa", async () => {
  const id = await enfileirar("olga/claim", { a: 1 });

  const lote = await ports.claimOutboxBatch(10, 5);
  const minha = lote.find((r) => String(r.id) === String(id));

  assert.ok(minha, "a linha nao publicada tem de ser reclamada");
  assert.equal(minha.attempts, 1, "attempts tem de subir no proprio claim");
  assert.deepEqual(minha.payload, { a: 1 }, "o payload volta como jsonb, nao como texto");
  assert.equal(minha.org_id, ids.org);
});

test("published_at e o que tira a linha da fila", async () => {
  const id = await enfileirar("olga/publicada", {});
  await ports.markOutboxPublished(id);

  const lote = await ports.claimOutboxBatch(100, 5);
  assert.ok(!lote.some((r) => String(r.id) === String(id)), "linha publicada nao pode voltar");
});

test("marcar publicado duas vezes nao reescreve o carimbo original", async () => {
  const id = await enfileirar("olga/carimbo", {});
  await ports.markOutboxPublished(id);
  const { rows: a } = await admin.query(`select published_at from mkt.outbox where id = $1`, [id]);
  await ports.markOutboxPublished(id);
  const { rows: b } = await admin.query(`select published_at from mkt.outbox where id = $1`, [id]);

  assert.deepEqual(a[0].published_at, b[0].published_at,
    "o guard `and published_at is null` existe para o carimbo ser o da entrega real");
});

test("linha acima de maxAttempts sai do caminho mas continua visivel", async () => {
  const id = await enfileirar("olga/veneno", {}, 5);

  const lote = await ports.claimOutboxBatch(100, 5);
  assert.ok(!lote.some((r) => String(r.id) === String(id)), "envenenada nao pode ser reclamada");

  const travadas = await ports.listStuckOutbox(5, 100);
  assert.ok(travadas.some((r) => String(r.id) === String(id)),
    "sem coluna de dead-letter, listStuckOutbox e o unico jeito de enxergar a linha");
});

test("skip locked: dois relays concorrentes nao pegam a mesma linha", async () => {
  await admin.query(`delete from mkt.outbox where org_id = $1`, [ids.org]);
  const ids2 = [];
  for (let i = 0; i < 6; i++) ids2.push(await enfileirar("olga/corrida", { i }));

  // Duas conexoes de verdade, cada uma numa transacao aberta: e a unica forma
  // de exercitar o skip locked, porque o lock so vale enquanto a transacao vive.
  const a = new pg.Client({ connectionString: url });
  const b = new pg.Client({ connectionString: url });
  await a.connect(); await b.connect();
  try {
    await a.query("begin"); await b.query("begin");
    const pa = createPostgresPorts(a, { schema: "mkt" }).outbox;
    const pb = createPostgresPorts(b, { schema: "mkt" }).outbox;

    const loteA = await pa.claimOutboxBatch(3, 5);
    const loteB = await pb.claimOutboxBatch(3, 5);

    await a.query("commit"); await b.query("commit");

    const setA = new Set(loteA.map((r) => String(r.id)));
    const setB = new Set(loteB.map((r) => String(r.id)));
    const interseccao = [...setA].filter((x) => setB.has(x));

    assert.equal(loteA.length, 3);
    assert.equal(loteB.length, 3, "sem skip locked, o segundo relay ficaria bloqueado esperando o primeiro");
    assert.deepEqual(interseccao, [],
      "dois relays entregando o mesmo evento e trabalho duplicado de proposito");
  } finally {
    await a.end(); await b.end();
  }
});

test("o ledger de dedup e unico por (consumer, event_key)", async () => {
  assert.equal(await ports.wasProcessed("teste-outbox", "outbox:42"), false);

  await ports.markProcessed("teste-outbox", "outbox:42");
  assert.equal(await ports.wasProcessed("teste-outbox", "outbox:42"), true);

  // Segunda marcacao nao pode explodir: reentrega concorrente e esperada.
  await ports.markProcessed("teste-outbox", "outbox:42");

  const { rows } = await admin.query(
    `select count(*)::int as n from mkt.processed_events where consumer = 'teste-outbox' and event_key = 'outbox:42'`);
  assert.equal(rows[0].n, 1);

  assert.equal(await ports.wasProcessed("outro-consumidor", "outbox:42"), false,
    "o mesmo evento pode ser consumido por mais de uma fila");
});
