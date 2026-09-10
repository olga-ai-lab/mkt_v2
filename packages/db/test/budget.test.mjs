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

// A versao 99 nao existe e nao vai existir: usar um numero livre faz o teste
// provar o que ele diz provar. Enquanto ele inseria a versao 2, a rejeicao
// passou a vir da chave primaria depois que a migration 0011 criou aquela
// versao — o teste continuava verde sem nunca tocar no indice one_active.
test("so existe uma rota ACTIVE por task class", async () => {
  await assert.rejects(
    () => db.query(`
      insert into mkt.model_routing (task_class, version, status, primary_target)
      values ('copywriting', 99, 'ACTIVE', '{"provider":"x","model":"y"}'::jsonb)`),
    /model_routing_one_active/i,
  );
});

test("uma segunda rota CANDIDATE convive com a ACTIVE", async () => {
  await db.query(`
    insert into mkt.model_routing (task_class, version, status, primary_target)
    values ('copywriting', 99, 'CANDIDATE', '{"provider":"x","model":"y"}'::jsonb)`);
  // O que importa nao e quantas versoes existem — e quantas estao ATIVAS.
  // Contar o total amarrava o teste ao numero de migrations ja aplicadas.
  const r = await db.query(
    `select count(*) filter (where status = 'ACTIVE')::int ativas,
            count(*)::int total
       from mkt.model_routing where task_class='copywriting'`);
  assert.equal(r.rows[0].ativas, 1);
  assert.ok(r.rows[0].total > 1, "a candidata precisa ter entrado");
  await db.query(`delete from mkt.model_routing where task_class='copywriting' and version=99`);
});

// ── O id do modelo precisa existir de verdade ──────────────────────────────
//
// As rotas apontaram para "claude-sonnet" e "claude-haiku" desde a 0007. Nao
// sao identificadores validos da API: a chamada falha com modelo desconhecido,
// e falha na PRIMEIRA vez que alguem roda de verdade — o que so aconteceria
// com um cliente na frente, porque nenhum teste chama provider real.
//
// A regra aqui e de forma, nao de catalogo: um id de familia sem versao nunca
// e valido. Conferir contra uma lista de modelos exigiria manter a lista, e
// uma lista desatualizada reprovaria um modelo novo e legitimo.
test("nenhuma rota ativa aponta para um id de modelo sem versao", async () => {
  const r = await db.query(`
    select task_class, primary_target->>'model' as modelo
      from mkt.model_routing
     where status = 'ACTIVE' and primary_target->>'provider' <> 'none'`);

  for (const rota of r.rows) {
    assert.match(rota.modelo, /^claude-[a-z]+-\d/,
      `${rota.task_class} roteia para "${rota.modelo}", que nao tem versao no id`);
  }
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
