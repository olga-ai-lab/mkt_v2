/**
 * O orcamento e a unica coisa entre o produto e uma conta de LLM surpresa.
 * Estes testes rodam contra Postgres real.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
const ids = {};

before(async () => {
  await db.connect();
  await db.query(`delete from mkt.organizations where slug = 'budget-test'`);
  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Budget Test','budget-test') returning id)
    insert into mkt.workspaces (org_id, name) select o.id, 'Principal' from o returning id, org_id`);
  ids.ws = r.rows[0].id;
  ids.org = r.rows[0].org_id;
});

after(async () => {
  await db.query(`delete from mkt.organizations where slug = 'budget-test'`);
  await db.end();
});

test("workspace sem orcamento devolve NULL, nao zero", async () => {
  const r = await db.query(`select mkt.remaining_budget_cents($1) as saldo`, [ids.ws]);
  assert.equal(r.rows[0].saldo, null,
    "NULL e 'sem teto configurado'; zero e 'teto atingido'. Confundir os dois deixa o produto gastar as cegas");
});

test("com orcamento e sem gasto, o saldo e o limite", async () => {
  await db.query(`
    insert into mkt.workspace_budgets (org_id, workspace_id, period_start, period_end, limit_cents)
    values ($1,$2, date_trunc('month', current_date)::date,
            (date_trunc('month', current_date) + interval '1 month')::date, 5000)`, [ids.org, ids.ws]);
  const r = await db.query(`select mkt.remaining_budget_cents($1) as saldo`, [ids.ws]);
  assert.equal(Number(r.rows[0].saldo), 5000);
});

test("cada gasto abate do saldo", async () => {
  for (const c of [10.5, 20.25, 4.25]) {
    await db.query(`
      insert into mkt.model_spend (org_id, workspace_id, task_class, cost_cents, trace_id)
      values ($1,$2,'copywriting',$3,'tr_b')`, [ids.org, ids.ws, c]);
  }
  const r = await db.query(`select mkt.remaining_budget_cents($1) as saldo`, [ids.ws]);
  assert.equal(Number(r.rows[0].saldo), 5000 - 35);
});

test("gasto de outro workspace nao contamina o saldo", async () => {
  const outro = await db.query(`
    insert into mkt.workspaces (org_id, name) values ($1,'Segundo') returning id`, [ids.org]);
  await db.query(`
    insert into mkt.model_spend (org_id, workspace_id, task_class, cost_cents, trace_id)
    values ($1,$2,'reasoning',999,'tr_outro')`, [ids.org, outro.rows[0].id]);
  const r = await db.query(`select mkt.remaining_budget_cents($1) as saldo`, [ids.ws]);
  assert.equal(Number(r.rows[0].saldo), 5000 - 35, "o gasto do vizinho entrou na minha conta");
});

test("custo negativo e recusado pela constraint", async () => {
  await assert.rejects(
    () => db.query(`insert into mkt.model_spend (org_id, workspace_id, task_class, cost_cents, trace_id)
                    values ($1,$2,'reasoning',-5,'tr_x')`, [ids.org, ids.ws]),
    /cost_cents/,
  );
});

test("so existe uma rota ACTIVE por task class", async () => {
  await assert.rejects(
    () => db.query(`
      insert into mkt.model_routing (task_class, version, status, primary_target)
      values ('copywriting', 2, 'ACTIVE', '{"provider":"x","model":"y"}'::jsonb)`),
    /model_routing_one_active|duplicate key/i,
  );
});

test("uma segunda rota CANDIDATE convive com a ACTIVE", async () => {
  await db.query(`
    insert into mkt.model_routing (task_class, version, status, primary_target)
    values ('copywriting', 3, 'CANDIDATE', '{"provider":"x","model":"y"}'::jsonb)`);
  const r = await db.query(`select count(*)::int n from mkt.model_routing where task_class='copywriting'`);
  assert.equal(r.rows[0].n, 2);
  await db.query(`delete from mkt.model_routing where task_class='copywriting' and version=3`);
});

test("rota sem provider ou model e recusada", async () => {
  await assert.rejects(
    () => db.query(`
      insert into mkt.model_routing (task_class, version, status, primary_target)
      values ('vision', 9, 'CANDIDATE', '{"modelo":"errado"}'::jsonb)`),
    /primary_target_shape/,
  );
});

test("image_generation nasce CANDIDATE: o maior custo unitario nao entra ligado", async () => {
  const r = await db.query(`select status from mkt.model_routing where task_class='image_generation'`);
  assert.equal(r.rows[0].status, "CANDIDATE");
});

// ── Custo por capability (C4) ───────────────────────────────────────────────
//
// `model_spend` sempre soube quanto custou uma execucao. Nao sabia sob qual
// capability o dinheiro saiu — entao dava para responder "quanto custou aquele
// run" e nao dava para responder "quanto custa gerar um post", que e a
// pergunta que alguem faz ANTES de mandar gerar quarenta.

test("a porta grava sob qual capability o gasto aconteceu", async () => {
  const { createPostgresPorts } = await import("@olga/runtime/ports-postgres");
  const ports = createPostgresPorts(db, { schema: "mkt" });

  await ports.budget.record({
    org_id: ids.org, workspace_id: ids.ws, task_class: "copywriting",
    cost_cents: 7.5, trace_id: "tr_c4_cap", provider: "anthropic", model: "m",
    capability_id: "content.create_draft",
  });

  const { rows } = await db.query(
    `select capability_id, cost_cents from mkt.model_spend where trace_id = 'tr_c4_cap'`);
  assert.equal(rows[0].capability_id, "content.create_draft");
});

test("o gasto do proprio loop fica sem capability, e isso e a informacao", async () => {
  // Resolver, planner e responder sao o loop pensando: nao rodam sob
  // capability nenhuma. Nulo aqui e o que separa custo de pensar de custo de
  // produzir — se fosse preenchido com um valor de conveniencia, a soma por
  // capability passaria a incluir o que aquela capability nao gastou.
  const { createPostgresPorts } = await import("@olga/runtime/ports-postgres");
  const ports = createPostgresPorts(db, { schema: "mkt" });

  await ports.budget.record({
    org_id: ids.org, workspace_id: ids.ws, task_class: "reasoning",
    cost_cents: 2.25, trace_id: "tr_c4_loop", provider: "anthropic", model: "m",
  });

  const { rows } = await db.query(
    `select capability_id from mkt.model_spend where trace_id = 'tr_c4_loop'`);
  assert.equal(rows[0].capability_id, null);
});

test("da para responder quanto custa cada capability, separado do custo do loop", async () => {
  // O aceite do C4 dito como consulta: e esta pergunta que nao tinha resposta.
  const { rows } = await db.query(
    `select coalesce(capability_id, '(loop)') as onde, sum(cost_cents)::float as total
       from mkt.model_spend
      where workspace_id = $1 and trace_id in ('tr_c4_cap','tr_c4_loop')
      group by 1 order by 1`, [ids.ws]);

  assert.deepEqual(rows, [
    { onde: "(loop)", total: 2.25 },
    { onde: "content.create_draft", total: 7.5 },
  ]);
});

test("o gasto continua abatendo do saldo, com capability ou sem", async () => {
  // A coluna nova nao pode ter mudado o que o orcamento enxerga: o teto vale
  // sobre o gasto inteiro, e nao sobre a parte dele que tem capability.
  const antes = await db.query(`select mkt.remaining_budget_cents($1) as saldo`, [ids.ws]);
  const { createPostgresPorts } = await import("@olga/runtime/ports-postgres");
  await createPostgresPorts(db, { schema: "mkt" }).budget.record({
    org_id: ids.org, workspace_id: ids.ws, task_class: "copywriting",
    cost_cents: 3, trace_id: "tr_c4_saldo", capability_id: "content.create_variant",
  });
  const depois = await db.query(`select mkt.remaining_budget_cents($1) as saldo`, [ids.ws]);
  assert.equal(Number(antes.rows[0].saldo) - Number(depois.rows[0].saldo), 3);
});
