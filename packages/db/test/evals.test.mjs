/**
 * Evals de agente, rodados contra o banco real.
 *
 * Cada caso vive em packages/runtime/evals/<agent-id>.json — como dado, do
 * mesmo jeito que capabilities e policies. Adicionar um caso é editar JSON,
 * não escrever teste.
 *
 * O que é roteirizado: SÓ a resposta do modelo. Tudo o mais é real — policies,
 * capability_registry, agent_registry, Model Gateway com orçamento, e o
 * Capability Gateway com os oito passos. Um eval que trouxesse as próprias
 * policies só provaria que concorda consigo mesmo.
 *
 * Estes evals medem GOVERNANÇA, não qualidade de texto. Ver o comentário
 * longo em packages/runtime/src/eval-runner.mjs sobre por que os dois tipos
 * não devem morar na mesma suíte.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createApprovalService } from "@olga/runtime/approvals";
import { runEvalCase } from "@olga/runtime/eval-runner";
import { createGateway } from "@olga/gateway";
import { createFakeMetaAdapter } from "@olga/gateway/adapters";
import { createWorkerPorts } from "../../../apps/worker/src/ports-worker.mjs";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
const EVALS_DIR = new URL("../../runtime/evals/", import.meta.url);

const ids = {};
let ports, workerPorts, gateway, casos = [];

const limpar = () => db.query(`delete from mkt.organizations where slug = 'eval-test'`);

before(async () => {
  await db.connect();
  await limpar();

  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Eval','eval-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name)
    select w.org_id, w.id, 'Marca' from w returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;

  await db.query(`insert into mkt.brand_brain_versions (org_id, brand_id, version, status)
                  values ($1,$2,1,'ACTIVE')`, [ids.org, ids.brand]);

  // Orcamento: sem ele o Model Gateway recusa rodar com BUDGET_NOT_CONFIGURED
  // — que e o desenho certo, e por isso o eval precisa configurar um.
  await db.query(`
    insert into mkt.workspace_budgets (org_id, workspace_id, period_start, period_end, limit_cents)
    values ($1,$2, date_trunc('month', current_date)::date,
            (date_trunc('month', current_date) + interval '1 month')::date, 100000)`,
    [ids.org, ids.ws]);

  const conn = await db.query(
    `insert into mkt.connections (org_id, workspace_id, channel, provider, external_account_id, status)
     values ($1,$2,'INSTAGRAM','meta','17841400000000000','ACTIVE') returning id`, [ids.org, ids.ws]);
  ids.conn = conn.rows[0].id;

  // Uma conexao de OUTRO workspace, para o caso da conexao intrusa.
  const w2 = await db.query(
    `insert into mkt.workspaces (org_id, name) values ($1,'Outro') returning id`, [ids.org]);
  const conn2 = await db.query(
    `insert into mkt.connections (org_id, workspace_id, channel, provider, external_account_id, status)
     values ($1,$2,'INSTAGRAM','meta','17841499999999999','ACTIVE') returning id`,
    [ids.org, w2.rows[0].id]);
  ids.conn_intrusa = conn2.rows[0].id;

  const c = await db.query(
    `insert into mkt.contents (org_id, workspace_id, brand_id, title)
     values ($1,$2,$3,'Post') returning id`, [ids.org, ids.ws, ids.brand]);
  const cv = await db.query(
    `insert into mkt.content_versions (org_id, content_id, version, master_body, state)
     values ($1,$2,1,'Texto.','DRAFT') returning id`, [ids.org, c.rows[0].id]);
  ids.cv = cv.rows[0].id;
  await db.query(
    `insert into mkt.channel_variants (org_id, content_version_id, channel, body, asset_refs)
     values ($1,$2,'INSTAGRAM','Corpo.','[{"url":"https://cdn.olga.test/a.jpg"}]'::jsonb)`,
    [ids.org, ids.cv]);
  // Conteudo aprovado, para os casos que chegam a publicar.
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [ids.cv]);
  await db.query(`update mkt.content_versions set state = 'APPROVED' where id = $1`, [ids.cv]);

  ports = createPostgresPorts(db, { schema: "mkt" });
  workerPorts = createWorkerPorts(db, { schema: "mkt" });
  const svc = createApprovalService({ approvals: ports.approvals });

  gateway = createGateway({
    registry: {
      getCapability: (id, v) => workerPorts.getCapability(id, v),
      newId: () => crypto.randomUUID(),
      isApprovalValid: (id, args) => svc.isApprovalValid(id, args),
    },
    policies: ports.policies,
    receipts: ports.receipts,
    adapters: { meta_graph: createFakeMetaAdapter(), internal: createFakeMetaAdapter({ idPrefix: "int" }) },
  });

  // Substitui os marcadores dos arquivos pelos ids reais do fixture.
  const subs = {
    __BRAND__: ids.brand, __CV__: ids.cv,
    __CONN__: ids.conn, __CONN_INTRUSA__: ids.conn_intrusa,
  };
  for (const f of readdirSync(EVALS_DIR).filter((x) => x.endsWith(".json"))) {
    let bruto = readFileSync(new URL(f, EVALS_DIR), "utf8");
    for (const [k, v] of Object.entries(subs)) bruto = bruto.replaceAll(k, v);
    const arquivo = JSON.parse(bruto);
    for (const caso of arquivo.casos) {
      casos.push({ ...caso, agent_id: arquivo.agent_id });
    }
  }
});

after(async () => { await limpar(); await db.end(); });

test("ha evals para os quatro agentes, com golden e adversarial", () => {
  const porAgente = {};
  for (const c of casos) {
    porAgente[c.agent_id] ??= { golden: 0, adversarial: 0 };
    porAgente[c.agent_id][c.kind]++;
  }
  assert.equal(Object.keys(porAgente).length, 4, "todo agente precisa de eval proprio");
  for (const [id, n] of Object.entries(porAgente)) {
    assert.ok(n.golden >= 1, `${id} sem caso golden: sem ele os adversariais nao provam nada`);
    assert.ok(n.adversarial >= 2, `${id} com menos de dois casos adversariais`);
  }
});

test("todo caso declara por que existe", () => {
  // Caso sem justificativa vira caso que ninguem sabe se pode apagar.
  const semPorque = casos.filter((c) => !c.porque || c.porque.length < 20);
  assert.deepEqual(semPorque.map((c) => c.id), []);
});

// Um teste por caso: a falha aponta o id, nao "um dos evals quebrou".
test("EVALS", async (t) => {
  const tenant = { org_id: ids.org, workspace_id: ids.ws };
  const falhados = [];

  for (const caso of casos) {
    await t.test(`${caso.id} — ${caso.titulo}`, async () => {
      const r = await runEvalCase(caso, { ports, workerPorts, gateway, tenant });
      if (!r.ok) {
        falhados.push({ id: caso.id, falhas: r.falhas, obtido: r.obtido });
        // Mostrar o que VEIO junto com o que faltou: um eval que so diz
        // "esperava X" manda quem le reproduzir a mao para descobrir o resto.
        assert.fail(
          `${caso.id} — ${caso.titulo}\n` +
          `  falhas: ${r.falhas.join(" | ")}\n` +
          `  veio:   ${JSON.stringify(r.obtido)}`);
      }
    });
  }
});
