/**
 * Contenção de incidente, contra Postgres real.
 *
 * A pergunta que este arquivo responde não é "a linha foi escrita?" — é "o
 * gateway para de deixar passar?". Um kill switch que grava uma policy e não
 * muda o comportamento é pior que nenhum: alguém aperta o botão, vê a
 * confirmação e vai dormir.
 *
 * Mestra §34 (conter com feature flag / capability disable / rollback), §46
 * (pré-requisito do piloto) e §B (falha S3 pede disable imediato).
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createContainmentService, PREFIXO } from "@olga/runtime/containment";
import { createGateway } from "@olga/gateway";
import { createInternalAdapter } from "@olga/gateway/adapters";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports, svc, gateway;

const DONO = { id: "u-dono", role: "OWNER" };
const MOTIVO = "incidente: post duplicado em conta de cliente";
const limpar = async () => {
  await db.query(`delete from mkt.organizations where slug in ('cont-test','cont-test-2')`);
  await db.query(`delete from mkt.rule_policies where policy_id like '${PREFIXO}%'`);
};

const tenant = () => ({ org_id: ids.org, workspace_id: ids.ws });

/** Pede uma escrita ao gateway e devolve o estado com que ela terminou. */
async function tentarEscrever(capability_id = "brand.propose_version", args = null) {
  const r = await gateway.execute({
    trace_id: "tr_cont",
    tenant: { org_id: ids.org, workspace_id: ids.ws, actor_id: "u-cont" },
    capability_id, capability_version: 1, mode: "write",
    args: args ?? { brand_id: ids.brand, identity: {}, tone: {},
                    claims_allowed: [], prohibitions: [], disclaimers: [],
                    source_refs: [{ kind: "WEB_PAGE", locator: "https://c.test/",
                                    hash: "h", retrieved_at: "2026-08-27T00:00:00.000Z" }] },
    requested_autonomy: "A2", approval_id: null,
    idempotency_key: `cont:${crypto.randomUUID()}`,
  }, { facts: {}, actor: { id: "u-cont", role: "OWNER", org_id: ids.org } });
  return r;
}

async function tentarLer() {
  return gateway.execute({
    trace_id: "tr_cont",
    tenant: { org_id: ids.org, workspace_id: ids.ws, actor_id: "u-cont" },
    capability_id: "brand.read", capability_version: 1, mode: "read",
    args: { brand_id: ids.brand },
    requested_autonomy: "A1", approval_id: null, idempotency_key: "cont:read",
  }, { facts: {}, actor: { id: "u-cont", role: "OWNER", org_id: ids.org } });
}

before(async () => {
  await db.connect();
  await limpar();
  ports = createPostgresPorts(db);
  svc = createContainmentService({ policies: ports.policies });
  gateway = createGateway({
    registry: {
      getCapability: (id, v) => ports.registry.getCapability(id, v),
      newId: () => crypto.randomUUID(),
      isApprovalValid: async () => ({ valid: true }),
    },
    policies: ports.policies,
    receipts: ports.receipts,
    adapters: {
      internal: createInternalAdapter({
        authoring: ports.authoring, knowledge: ports.knowledge, publishing: ports.publishing,
      }),
    },
  });
});

beforeEach(async () => {
  await limpar();
  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Cont','cont-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name, website_url)
    select w.org_id, w.id, 'Corretora', 'https://c.test' from w
    returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;
  await db.query(
    `insert into mkt.brand_brain_versions (org_id, brand_id, version, status)
     values ($1,$2,1,'ACTIVE')`, [ids.org, ids.brand]);
});

after(async () => { await limpar(); await db.end(); });

// ── O kill switch para de verdade ───────────────────────────────────────────

test("antes de conter, a escrita passa", async () => {
  const r = await tentarEscrever();
  assert.equal(r.execution.status, "SUCCEEDED", JSON.stringify(r.execution.error));
});

test("killWrites para TODA escrita, e vale no run seguinte", async () => {
  // Sem cache de policy, e isso é requisito: um cache de cinco minutos aqui
  // seria cinco minutos de posts saindo depois de alguém apertar parar.
  await svc.killWrites({ tenant: tenant(), actor: DONO, reason: MOTIVO });

  const r = await tentarEscrever();
  assert.equal(r.execution.status, "BLOCKED");
  assert.equal(r.respondability.state, "POLICY_BLOCKED");
});

test("conter escrita nao desliga leitura", async () => {
  // "Degradar quando for seguro": um agente que só lê continua útil enquanto o
  // incidente é investigado.
  await svc.killWrites({ tenant: tenant(), actor: DONO, reason: MOTIVO });
  const r = await tentarLer();
  assert.equal(r.execution.status, "SUCCEEDED", JSON.stringify(r.execution.error));
});

test("a contencao e do tenant que a pediu, e nao dos vizinhos", async () => {
  await svc.killWrites({ tenant: tenant(), actor: DONO, reason: MOTIVO });

  const outro = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Vizinho','cont-test-2') returning id)
    insert into mkt.workspaces (org_id, name) select id, 'W' from o returning id, org_id`);
  const politicas = await ports.policies.listActive(outro.rows[0].org_id);
  assert.ok(!politicas.some((p) => p.policy_id.startsWith(PREFIXO)),
    "conter um workspace nao pode parar o produto inteiro");
});

test("killCapability para so aquela, e o resto segue", async () => {
  await svc.killCapability({
    tenant: tenant(), actor: DONO, capability_id: "brand.propose_version", reason: MOTIVO });

  assert.equal((await tentarEscrever()).execution.status, "BLOCKED");
  assert.equal((await tentarLer()).execution.status, "SUCCEEDED");
});

// ── Degradar em vez de desligar ─────────────────────────────────────────────

test("degradeAgent baixa o teto para A1 em vez de bloquear", async () => {
  const r = await svc.degradeAgent({
    tenant: tenant(), actor: DONO, agent_id: "AGT-MKT-CONTENT", reason: MOTIVO });

  assert.equal(r.effect, "ALLOW");
  assert.equal(r.max_autonomy, "A1");

  const politicas = await ports.policies.listActive(ids.org);
  const p = politicas.find((x) => x.policy_id === `${PREFIXO}DEGRADE_AGT-MKT-CONTENT`);
  assert.equal(p.priority, 0, "uma contencao que perde para policy de negocio nao contem");
});

// ── A operação ──────────────────────────────────────────────────────────────

test("apertar o botao duas vezes nao cria duas contencoes", async () => {
  // Durante um incidente o botão é apertado duas vezes, e a segunda não pode
  // virar uma policy duplicada que alguém depois levanta pela metade.
  await svc.killWrites({ tenant: tenant(), actor: DONO, reason: MOTIVO });
  await svc.killWrites({ tenant: tenant(), actor: DONO, reason: MOTIVO + " (de novo)" });

  const lista = await svc.list({ tenant: tenant() });
  assert.equal(lista.filter((p) => p.policy_id === `${PREFIXO}ALL_WRITES`).length, 1);
  assert.match(lista[0].reason, /de novo/);
});

test("contencao sem motivo escrito nao acontece", async () => {
  await assert.rejects(
    () => svc.killWrites({ tenant: tenant(), actor: DONO, reason: "erro" }),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED");
  assert.equal((await svc.list({ tenant: tenant() })).length, 0);
});

test("so dono contem", async () => {
  for (const role of ["MARKETING", "APPROVER"]) {
    await assert.rejects(
      () => svc.killWrites({ tenant: tenant(), actor: { id: "u", role }, reason: MOTIVO }),
      (e) => e.reason_code === "ACTOR_ROLE_FORBIDDEN" && e.status === 403);
  }
});

test("levantar devolve a escrita, e guarda que houve contencao", async () => {
  await svc.killWrites({ tenant: tenant(), actor: DONO, reason: MOTIVO });
  await svc.lift({ tenant: tenant(), actor: DONO, policy_id: `${PREFIXO}ALL_WRITES`,
                   reason: "causa corrigida e post duplicado removido" });

  assert.equal((await tentarEscrever()).execution.status, "SUCCEEDED");
  assert.deepEqual(await svc.list({ tenant: tenant() }), []);

  // Apagar tiraria do histórico que houve contenção, e "houve contenção entre
  // terça e quinta" é exatamente o que se pergunta depois.
  const { rows } = await db.query(
    `select status::text as status, reason from mkt.rule_policies
      where org_id = $1 and policy_id = $2`, [ids.org, `${PREFIXO}ALL_WRITES`]);
  assert.equal(rows[0].status, "BLOCKED");
  assert.match(rows[0].reason, /causa corrigida/);
});

test("levantar policy de negocio pela porta da contencao nao passa", async () => {
  await assert.rejects(
    () => svc.lift({ tenant: tenant(), actor: DONO, policy_id: "POL_DRAFT_DEFAULT",
                     reason: "quero liberar isso agora" }),
    (e) => e.reason_code === "UNSUPPORTED_VALUE");
});

test("levantar o que nao esta contido e recusa, e nao silencio", async () => {
  await assert.rejects(
    () => svc.lift({ tenant: tenant(), actor: DONO, policy_id: `${PREFIXO}ALL_WRITES`,
                     reason: "achei que estava contido" }),
    (e) => e.reason_code === "NORMALIZATION_FAILED" && e.status === 404);
});

test("a lista diz o que esta contido, por quem e desde quando", async () => {
  await svc.killWrites({ tenant: tenant(), actor: DONO, reason: MOTIVO,
                         expires_at: "2026-09-01T00:00:00.000Z" });
  const [p] = await svc.list({ tenant: tenant() });

  assert.equal(p.created_by, DONO.id);
  assert.equal(p.reason, MOTIVO);
  assert.ok(p.created_at);
  assert.ok(p.expires_at, "expira e informacao para o runbook, nao gatilho automatico");
});

// ── Rollback de agente ──────────────────────────────────────────────────────

test("a porta serve a versao ACTIVE, e nao a maior", async () => {
  // Era `order by version desc` puro. Uma v2 DEPRECATED continuaria sendo
  // servida sobre a v1 ACTIVE, e marcar a v2 como DEPRECATED não desfazia nada.
  await db.query(
    `insert into mkt.agent_registry
       (agent_id, version, status, mission, modes, baseline_autonomy, max_autonomy, capabilities)
     values ('AGT-MKT-COPILOT', 2, 'DEPRECATED', 'v2 que deu errado',
             '{read}'::mkt.capability_mode[], 'A1', 'A2', '{brand.read}')`);

  const a = await ports.registry.getAgent("AGT-MKT-COPILOT");
  assert.equal(a.version, 1);
  assert.equal(a.status, "ACTIVE");

  await db.query(`delete from mkt.agent_registry where agent_id = 'AGT-MKT-COPILOT' and version = 2`);
});

test("duas versoes ACTIVE do mesmo agente nao entram", async () => {
  await assert.rejects(
    () => db.query(
      `insert into mkt.agent_registry
         (agent_id, version, status, mission, modes, baseline_autonomy, max_autonomy)
       values ('AGT-MKT-COPILOT', 3, 'ACTIVE', 'duplicata',
               '{read}'::mkt.capability_mode[], 'A1', 'A2')`),
    /agent_registry_one_active/);
});
