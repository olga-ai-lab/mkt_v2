/**
 * O trace de um run, contra Postgres real (Mestra §30).
 *
 * A tabela `mkt.agent_runs` existe desde a 0005 com colunas para modelo,
 * versão de prompt, tokens e custo. Nenhuma delas era escrita: o loop não vê as
 * chamadas de modelo — elas acontecem dentro das pontas — e `agent_run_id`
 * nunca chegava ao Model Gateway, então `mkt.model_spend` não tinha como ser
 * ligado ao run.
 *
 * Coluna vazia é pior que coluna ausente: parece preenchida até alguém
 * consultar, e quem consulta é a auditoria de um incidente.
 *
 * O que se prova aqui: que a linha "Performance" do trace sai do LEDGER, e não
 * de uma segunda contabilidade que um dia discordaria dele.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports;

const limpar = () => db.query(`delete from mkt.organizations where slug = 'trace-test'`);

const gasto = (run_id, { model, input_tokens, output_tokens, cost_cents, task_class = "reasoning" }) =>
  ports.budget.record({
    org_id: ids.org, workspace_id: ids.ws, agent_run_id: run_id,
    task_class, provider: "anthropic", model,
    input_tokens, output_tokens, cost_cents,
    fallback_used: false, trace_id: "tr_trace",
  });

const runDe = async (id) => {
  const { rows } = await db.query(
    `select model, prompt_version, persona_version, input_tokens, output_tokens,
            cost_cents, respondability, latency_ms, status::text as status
       from mkt.agent_runs where id = $1`, [id]);
  return rows[0];
};

async function abrirRun(extra = {}) {
  const id = crypto.randomUUID();
  await ports.runs.start({
    id, org_id: ids.org, workspace_id: ids.ws, trace_id: "tr_trace",
    agent_id: "AGT-MKT-COPILOT", agent_version: 1, task_class: "reasoning",
    persona_version: 1, prompt_version: "1",
    status: "RUNNING", started_at: new Date().toISOString(), ...extra,
  });
  return id;
}

before(async () => {
  await db.connect();
  await limpar();
  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Trace','trace-test') returning id)
    insert into mkt.workspaces (org_id, name) select id, 'Principal' from o
    returning id, org_id`);
  ids.ws = r.rows[0].id; ids.org = r.rows[0].org_id;
  ports = createPostgresPorts(db);
});

beforeEach(() => db.query(`delete from mkt.agent_runs where org_id = $1`, [ids.org]));
after(async () => { await limpar(); await db.end(); });

// ── Versions (Mestra §30) ───────────────────────────────────────────────────

test("o run nasce com a versao da persona e a do conjunto de prompts", async () => {
  // Sem as duas não se reproduz um incidente: "o agente respondeu isso em
  // setembro" fica sem resposta se ninguém sabe com que persona e que prompts
  // ele respondia em setembro.
  const id = await abrirRun();
  const r = await runDe(id);
  assert.equal(r.persona_version, 1);
  assert.equal(r.prompt_version, "1");
});

test("agente sem persona registra nulo, e nao uma versao inventada", async () => {
  const id = await abrirRun({ persona_version: null });
  assert.equal((await runDe(id)).persona_version, null);
});

// ── Performance, vinda do ledger ────────────────────────────────────────────

test("fechar o run soma o gasto do proprio ledger", async () => {
  const id = await abrirRun();
  await gasto(id, { model: "claude-haiku", input_tokens: 100, output_tokens: 40, cost_cents: 1.5 });
  await gasto(id, { model: "claude-haiku", input_tokens: 200, output_tokens: 60, cost_cents: 2.5 });

  await ports.runs.finish(id, {
    status: "SUCCEEDED", respondability: "EXECUTABLE", reason_codes: [],
    autonomy_used: "A2", latency_ms: 1234, finished_at: new Date().toISOString(),
  });

  const r = await runDe(id);
  assert.equal(r.input_tokens, 300);
  assert.equal(r.output_tokens, 100);
  assert.equal(Number(r.cost_cents), 4);
  assert.equal(r.latency_ms, 1234);
  assert.equal(r.respondability, "EXECUTABLE");
});

test("run com duas rotas registra os dois modelos, e nao esconde um", async () => {
  // Um run usa rotas diferentes: o resolver é extraction, o responder é
  // copywriting. Guardar um modelo só faria o trace mentir sobre o que
  // respondeu.
  const id = await abrirRun();
  await gasto(id, { model: "claude-haiku", input_tokens: 10, output_tokens: 5, cost_cents: 0.1,
                    task_class: "extraction" });
  await gasto(id, { model: "claude-sonnet", input_tokens: 20, output_tokens: 8, cost_cents: 0.9,
                    task_class: "copywriting" });

  await ports.runs.finish(id, { status: "SUCCEEDED", latency_ms: 10 });

  assert.equal((await runDe(id)).model, "claude-haiku+claude-sonnet");
});

test("run que nao gastou nada fecha sem inventar numero", async () => {
  // Um run que parou em CLARIFICATION_REQUIRED antes de chamar modelo nenhum
  // não tem custo. Zero e nulo não são a mesma coisa, e escrever zero diria
  // "consultei o modelo e não custou".
  const id = await abrirRun();
  await ports.runs.finish(id, {
    status: "FAILED", respondability: "CLARIFICATION_REQUIRED", latency_ms: 5,
  });

  const r = await runDe(id);
  assert.equal(r.model, null);
  assert.equal(r.cost_cents, null);
  assert.equal(r.respondability, "CLARIFICATION_REQUIRED");
});

test("o gasto de outro run nao entra na conta deste", async () => {
  const a = await abrirRun();
  const b = await abrirRun();
  await gasto(a, { model: "claude-haiku", input_tokens: 100, output_tokens: 10, cost_cents: 1 });
  await gasto(b, { model: "claude-haiku", input_tokens: 999, output_tokens: 99, cost_cents: 9 });

  await ports.runs.finish(a, { status: "SUCCEEDED", latency_ms: 1 });
  assert.equal((await runDe(a)).input_tokens, 100);
});

test("o ledger continua sendo quem responde sobre dinheiro", async () => {
  // A linha do run denormaliza o total para o trace ser auto-suficiente; ela
  // não substitui o ledger, que é por chamada e sobrevive ao run.
  const id = await abrirRun();
  await gasto(id, { model: "claude-haiku", input_tokens: 10, output_tokens: 5, cost_cents: 0.7 });
  await ports.runs.finish(id, { status: "SUCCEEDED", latency_ms: 1 });

  const { rows } = await db.query(
    `select count(*)::int as n, sum(cost_cents) as total
       from mkt.model_spend where agent_run_id = $1`, [id]);
  assert.equal(rows[0].n, 1);
  assert.equal(Number(rows[0].total), Number((await runDe(id)).cost_cents));
});
