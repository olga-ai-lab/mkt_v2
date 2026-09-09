/**
 * Slots recorrentes contra o banco de verdade (C3).
 *
 * A funcao de cadencia tem teste proprio, puro. Este arquivo responde outra
 * pergunta: o agendador, ligado no Capability Gateway e no Postgres, produz os
 * tres desfechos certos — e nenhum deles em silencio.
 *
 * O gateway aqui e o REAL, com o adapter interno real e as policies do banco.
 * Um dublê de gateway aprovaria o caminho que ninguem montou, que e o erro
 * recorrente deste repositorio.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createWorkerPorts } from "../../../apps/worker/src/ports-worker.mjs";
import { createScheduleRunner, SCHEDULE_DB_SURFACE } from "../../../apps/worker/src/schedule-runner.mjs";
import { createGateway } from "@olga/gateway";
import { createInternalAdapter } from "@olga/gateway/adapters";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
const ids = {};
let ports, worker, runner, eventos;

const limpar = async () => {
  await db.query(`delete from mkt.organizations where slug = 'slot-test'`);
  await db.query(`delete from mkt.app_users where email = 'slot@olga.test'`);
};
const ONTEM = new Date(Date.now() - 86400000);

before(async () => {
  await db.connect();
  await limpar();

  const u = await db.query(
    `insert into mkt.app_users (email, full_name) values ('slot@olga.test','Slot')
     on conflict (email) do update set full_name = excluded.full_name returning id`);
  ids.user = u.rows[0].id;

  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Slot','slot-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name)
    select w.org_id, w.id, 'Marca' from w returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;

  await db.query(
    `insert into mkt.brand_brain_versions (org_id, brand_id, version, status)
     values ($1,$2,1,'ACTIVE')`, [ids.org, ids.brand]);

  const conn = await db.query(
    `insert into mkt.connections (org_id, workspace_id, channel, provider, external_account_id, status)
     values ($1,$2,'INSTAGRAM','meta','ig-slot','ACTIVE') returning id`, [ids.org, ids.ws]);
  ids.conn = conn.rows[0].id;

  // O slot roda sob a autoridade de quem o criou, com o papel que essa pessoa
  // tem no momento da ocorrencia. Sem membership, nao ha ocorrencia.
  await db.query(
    `insert into mkt.memberships (org_id, user_id, role) values ($1,$2,'OWNER')`,
    [ids.org, ids.user]);

  ports = createPostgresPorts(db, { schema: "mkt" });
  worker = createWorkerPorts(db, { schema: "mkt" });

  const gateway = createGateway({
    registry: {
      getCapability: (id, v) => worker.getCapability(id, v),
      newId: () => crypto.randomUUID(),
      isApprovalValid: async () => true,
    },
    policies: ports.policies,
    receipts: ports.receipts,
    adapters: {
      internal: createInternalAdapter({
        authoring: ports.authoring, knowledge: ports.knowledge, publishing: ports.publishing,
      }),
    },
  });

  eventos = [];
  runner = createScheduleRunner({
    gateway,
    db: { ...worker, ...ports.schedules },
    tracer: { event: (e) => eventos.push(e) },
  });
});

after(async () => { await limpar(); await db.end(); });

beforeEach(async () => {
  eventos.length = 0;
  await db.query(`delete from mkt.outbox where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.publications where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.contents where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.publication_schedules where org_id = $1`, [ids.org]);
});

/** Um slot diario ja vencido. */
const slotVencido = () => ports.schedules.create({
  org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM", connection_id: ids.conn,
  cadence: "DAILY", at_hour_utc: 9, next_run_at: ONTEM, created_by: ids.user,
});

/** Conteudo num estado dado, com variante para o Instagram. */
async function conteudo(state, corpo = "Texto do post.") {
  const c = await db.query(
    `insert into mkt.contents (org_id, workspace_id, brand_id, title)
     values ($1,$2,$3,'Post') returning id`, [ids.org, ids.ws, ids.brand]);
  const cv = await db.query(
    `insert into mkt.content_versions (org_id, content_id, version, master_body, state)
     values ($1,$2,1,$3,'DRAFT') returning id`, [ids.org, c.rows[0].id, corpo]);
  const id = cv.rows[0].id;
  await db.query(
    `insert into mkt.channel_variants (org_id, content_version_id, channel, body)
     values ($1,$2,'INSTAGRAM','Corpo do canal.')`, [ids.org, id]);
  // A state machine nao deixa pular: DRAFT -> AI_REVIEW -> APPROVED.
  if (state !== "DRAFT") {
    await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [id]);
    if (state !== "AI_REVIEW") {
      await db.query(`update mkt.content_versions set state = $2::mkt.content_state where id = $1`,
                     [id, state]);
    }
  }
  return id;
}

const slotDoBanco = async (id) => (await db.query(
  `select last_outcome, last_reason_code, next_run_at, last_run_at
     from mkt.publication_schedules where id = $1`, [id])).rows[0];

// ── Os tres desfechos ───────────────────────────────────────────────────────

test("slot vencido com conteudo aprovado agenda, pelo Capability Gateway", async () => {
  const slot = await slotVencido();
  const cv = await conteudo("APPROVED");

  const r = await runner();

  assert.equal(r.agendados, 1);
  const linha = await slotDoBanco(slot.id);
  assert.equal(linha.last_outcome, "SCHEDULED");
  assert.equal(linha.last_reason_code, null);

  // O efeito de verdade: publicacao criada e evento no outbox. Se o runner
  // tivesse escrito direto no banco em vez de passar pelo gateway, os dois
  // existiriam igual — o que prova o caminho e o receipt do passo seguinte
  // e o estado do conteudo, que so a capability move.
  const pub = await db.query(
    `select status::text as status from mkt.publications where content_version_id = $1`, [cv]);
  assert.equal(pub.rows.length, 1);
  assert.equal(pub.rows[0].status, "SCHEDULED");

  const estado = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [cv]);
  assert.equal(estado.rows[0].state, "SCHEDULED");

  const evt = await db.query(
    `select 1 from mkt.outbox where org_id = $1 and event_type = 'olga/content.publish.requested'`,
    [ids.org]);
  assert.equal(evt.rows.length, 1);
});

test("slot vencido sem conteudo aprovado nao publica nada, e isso nao e falha", async () => {
  // O estado esperado de um calendario que anda mais rapido que a producao.
  // Trata-lo como erro encheria o alerta de ruido ate ninguem mais olhar.
  const slot = await slotVencido();
  await conteudo("DRAFT");

  const r = await runner();

  assert.equal(r.sem_conteudo, 1);
  assert.equal(r.agendados, 0);
  assert.equal((await slotDoBanco(slot.id)).last_outcome, "NO_CONTENT");
  assert.equal(
    (await db.query(`select 1 from mkt.publications where org_id = $1`, [ids.org])).rows.length, 0);
});

test("conteudo aprovado sem variante do canal nao e escolhido", async () => {
  // Agendar sem variante criaria uma publicacao que falharia depois, no
  // adapter, longe daqui.
  const slot = await slotVencido();
  const c = await db.query(
    `insert into mkt.contents (org_id, workspace_id, brand_id, title)
     values ($1,$2,$3,'Sem variante') returning id`, [ids.org, ids.ws, ids.brand]);
  const cv = await db.query(
    `insert into mkt.content_versions (org_id, content_id, version, master_body, state)
     values ($1,$2,1,'Texto.','DRAFT') returning id`, [ids.org, c.rows[0].id]);
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [cv.rows[0].id]);
  await db.query(`update mkt.content_versions set state = 'APPROVED' where id = $1`, [cv.rows[0].id]);

  await runner();
  assert.equal((await slotDoBanco(slot.id)).last_outcome, "NO_CONTENT");
});

test("policy que recusa deixa o motivo na linha do slot, e nao passa em silencio", async () => {
  // Conexao derrubada: POL_BLOCK_UNCONNECTED_CHANNEL bloqueia com
  // CHANNEL_NOT_CONNECTED. Um slot que para de publicar sem dizer por que e a
  // pior falha possivel de um agendador.
  const slot = await slotVencido();
  await conteudo("APPROVED");
  await db.query(`update mkt.connections set status = 'REVOKED' where id = $1`, [ids.conn]);

  try {
    const r = await runner();
    assert.equal(r.bloqueados, 1);
    const linha = await slotDoBanco(slot.id);
    assert.equal(linha.last_outcome, "BLOCKED");
    assert.equal(linha.last_reason_code, "CHANNEL_NOT_CONNECTED");
    assert.equal(
      (await db.query(`select 1 from mkt.publications where org_id = $1`, [ids.org])).rows.length, 0,
      "bloqueado nao pode ter criado publicacao");
  } finally {
    await db.query(`update mkt.connections set status = 'ACTIVE' where id = $1`, [ids.conn]);
  }
});

// ── O slot avanca sempre ────────────────────────────────────────────────────

test("o slot avanca nos tres desfechos, e nunca para o passado", async () => {
  // Um slot que nao avancasse por falta de conteudo tentaria de novo a cada
  // passada, e no dia em que houvesse conteudo publicaria a ocorrencia
  // atrasada como se fosse a de hoje.
  for (const preparar of [
    async () => { await conteudo("APPROVED"); },
    async () => { await conteudo("DRAFT"); },
  ]) {
    await db.query(`delete from mkt.publication_schedules where org_id = $1`, [ids.org]);
    await db.query(`delete from mkt.publications where org_id = $1`, [ids.org]);
    await db.query(`delete from mkt.contents where org_id = $1`, [ids.org]);

    const slot = await slotVencido();
    await preparar();
    await runner();

    const linha = await slotDoBanco(slot.id);
    assert.ok(new Date(linha.next_run_at) > new Date(),
      `slot ficou no passado: ${linha.next_run_at} (${linha.last_outcome})`);
    assert.ok(linha.last_run_at, "avancar sem registrar quando rodou esconde o historico");
  }
});

test("duas passadas seguidas nao agendam o mesmo conteudo duas vezes", async () => {
  // Depois da primeira, o conteudo saiu de APPROVED e ja tem publicacao — as
  // duas condicoes de `nextApproved` deixam de valer.
  await slotVencido();
  await conteudo("APPROVED");

  const primeira = await runner();
  const segunda = await runner();

  assert.equal(primeira.agendados, 1);
  assert.equal(segunda.avaliados, 0, "o slot ja avancou para o futuro; nao vence de novo hoje");
  assert.equal(
    (await db.query(`select 1 from mkt.publications where org_id = $1`, [ids.org])).rows.length, 1);
});

test("slot inativo nao vence", async () => {
  const slot = await slotVencido();
  await conteudo("APPROVED");
  await db.query(`update mkt.publication_schedules set active = false where id = $1`, [slot.id]);

  assert.equal((await runner()).avaliados, 0);
});

test("slot de outro workspace nao pega conteudo deste", async () => {
  const w2 = await db.query(
    `insert into mkt.workspaces (org_id, name) values ($1,'Outro') returning id`, [ids.org]);
  const conn2 = await db.query(
    `insert into mkt.connections (org_id, workspace_id, channel, provider, external_account_id, status)
     values ($1,$2,'INSTAGRAM','meta','ig-outro','ACTIVE') returning id`, [ids.org, w2.rows[0].id]);
  const slot = await ports.schedules.create({
    org_id: ids.org, workspace_id: w2.rows[0].id, channel: "INSTAGRAM",
    connection_id: conn2.rows[0].id, cadence: "DAILY", at_hour_utc: 9, next_run_at: ONTEM,
    created_by: ids.user,
  });
  await conteudo("APPROVED");   // pertence ao workspace ORIGINAL

  await runner();
  assert.equal((await slotDoBanco(slot.id)).last_outcome, "NO_CONTENT",
    "conteudo de outro workspace nao pode alimentar este slot");
});

// ── A constraint da cadencia ────────────────────────────────────────────────

test("cadencia sem o proprio campo e recusada pelo banco", async () => {
  // WEEKLY sem at_weekday seria aceito e nunca rodaria no dia certo — falha
  // silenciosa, que e a pior classe para um agendador.
  await assert.rejects(() => ports.schedules.create({
    org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM", connection_id: ids.conn,
    cadence: "WEEKLY", at_hour_utc: 9, next_run_at: ONTEM,
  }), /cadence_exige_o_proprio_campo/);

  await assert.rejects(() => ports.schedules.create({
    org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM", connection_id: ids.conn,
    cadence: "MONTHLY", at_hour_utc: 9, at_weekday: 3, next_run_at: ONTEM,
  }), /cadence_exige_o_proprio_campo/);
});

test("dia do mes acima de 28 e recusado", async () => {
  // Aceitar 31 criaria um slot que some em fevereiro.
  await assert.rejects(() => ports.schedules.create({
    org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM", connection_id: ids.conn,
    cadence: "MONTHLY", at_hour_utc: 9, at_monthday: 31, next_run_at: ONTEM,
  }));
});

test("a superficie declarada cobre tudo que o runner chama em db", () => {
  const faltando = SCHEDULE_DB_SURFACE.filter(
    (m) => typeof ({ ...worker, ...ports.schedules })[m] !== "function");
  assert.deepEqual(faltando, [],
    "metodo faltando aqui so apareceria na primeira passada real do agendador");
});

// ── O calendario (C2) ───────────────────────────────────────────────────────
//
// Leitura pura sobre o que ja existe. Nao ha tabela de calendario, e nao
// deveria haver: uma segunda verdade sobre o que vai ao ar discordaria de
// `publications` um dia.

test("o calendario traz o agendado e o publicado na mesma janela", async () => {
  // Passado e futuro juntos de proposito: sem o passado, nao da para notar a
  // semana que ficou vazia.
  await slotVencido();
  await conteudo("APPROVED");
  await runner();

  const de = new Date(Date.now() - 7 * 86400000);
  const ate = new Date(Date.now() + 28 * 86400000);
  const marcados = await ports.calendar.range(ids.org, ids.ws, { de, ate });

  assert.equal(marcados.length, 1);
  assert.equal(marcados[0].status, "SCHEDULED");
  assert.equal(marcados[0].channel, "INSTAGRAM");
  assert.ok(marcados[0].title, "o calendario precisa do titulo, nao so do id");
  assert.ok(marcados[0].quando, "linha sem data nao tem lugar num calendario");
});

test("a janela do calendario e respeitada nas duas pontas", async () => {
  await slotVencido();
  await conteudo("APPROVED");
  await runner();

  const futuro = { de: new Date(Date.now() + 60 * 86400000), ate: new Date(Date.now() + 90 * 86400000) };
  assert.deepEqual(await ports.calendar.range(ids.org, ids.ws, futuro), []);

  const passado = { de: new Date(Date.now() - 90 * 86400000), ate: new Date(Date.now() - 60 * 86400000) };
  assert.deepEqual(await ports.calendar.range(ids.org, ids.ws, passado), []);
});

test("o calendario nao atravessa workspace", async () => {
  await slotVencido();
  await conteudo("APPROVED");
  await runner();

  const w2 = await db.query(
    `insert into mkt.workspaces (org_id, name) values ($1,'Vizinho') returning id`, [ids.org]);
  const marcados = await ports.calendar.range(ids.org, w2.rows[0].id, {
    de: new Date(Date.now() - 7 * 86400000), ate: new Date(Date.now() + 28 * 86400000),
  });
  assert.deepEqual(marcados, []);
});

test("a fila de prontos conta o que os slots ainda podem consumir", async () => {
  // O numero que decide se vale gerar mais: um slot diario com dois aprovados
  // fica sem conteudo em dois dias.
  await conteudo("APPROVED", "Primeiro texto.");
  await conteudo("APPROVED", "Segundo texto.");
  await conteudo("DRAFT", "Terceiro, ainda rascunho.");

  const prontos = await ports.calendar.prontosPorCanal(ids.org, ids.ws);
  assert.deepEqual(prontos, [{ channel: "INSTAGRAM", prontos: 2 }]);
});

test("conteudo ja agendado sai da fila de prontos", async () => {
  // Senao a tela diria que ha o que publicar depois de o slot ja ter
  // consumido, e a pessoa deixaria de gerar exatamente quando precisava.
  await slotVencido();
  await conteudo("APPROVED");

  assert.deepEqual(await ports.calendar.prontosPorCanal(ids.org, ids.ws),
    [{ channel: "INSTAGRAM", prontos: 1 }]);

  await runner();

  assert.deepEqual(await ports.calendar.prontosPorCanal(ids.org, ids.ws), []);
});
