/**
 * A revisao de IA, contra Postgres real.
 *
 * Este arquivo existe por causa de um beco silencioso: a J11 nao liga DRAFT a
 * revisao humana — AI_REVIEW vem antes — e nada movia DRAFT para AI_REVIEW.
 * Todo conteudo criado pelo agente ficava preso, e `approval.request` recusava
 * corretamente por uma etapa que ninguem tinha como cumprir.
 *
 * O que so aparece aqui: o trigger da state machine, que e quem de fato recusa
 * o pulo, e a linha em mkt.marketing_events, que e o que responde "o que a IA
 * conferiu" tres meses depois.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createGateway } from "@olga/gateway";
import { createInternalAdapter } from "@olga/gateway/adapters";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports, gateway;

const limpar = () => db.query(`delete from mkt.organizations where slug = 'rev-test'`);

const pedido = (capability_id, args, mode = "write") => ({
  trace_id: "tr_rev",
  tenant: { org_id: ids.org, workspace_id: ids.ws, actor_id: "u-rev" },
  capability_id, capability_version: 1, mode, args,
  requested_autonomy: "A2", approval_id: null,
  idempotency_key: `rev:${capability_id}:${args.content_version_id}`,
});

const contexto = () => ({ facts: {}, actor: { id: "u-rev", role: "OWNER", org_id: ids.org } });

const estadoDe = async (cvid) => {
  const { rows } = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [cvid]);
  return rows[0].state;
};

const eventosDe = async (cvid) => {
  const { rows } = await db.query(
    `select event_type, actor_type::text as actor_type, properties, trace_id
       from mkt.marketing_events where object_id = $1 order by id`, [cvid]);
  return rows;
};

/** Uma versao de conteudo em DRAFT. Com claim material sem lastro, se pedido. */
async function conteudo({ claimSemLastro = false, corpo = null } = {}) {
  const c = await db.query(
    `insert into mkt.contents (org_id, workspace_id, brand_id, title)
     values ($1,$2,$3,'Post') returning id`, [ids.org, ids.ws, ids.brand]);
  const cv = await db.query(
    `insert into mkt.content_versions (org_id, content_id, version, master_body, state)
     values ($1,$2,1,$3,'DRAFT') returning id`,
    [ids.org, c.rows[0].id, corpo ?? `Texto ${crypto.randomUUID()}.`]);
  const cvid = cv.rows[0].id;

  if (claimSemLastro) {
    // A constraint impede claim material entrar com array vazio, entao o jeito
    // de ter um claim sem lastro e o jeito REAL: a evidence some depois.
    const ev = await db.query(
      `insert into mkt.evidence (org_id, workspace_id, source_kind, locator, hash, fact, quality)
       values ($1,$2,'SOURCE_ARTIFACT','https://x.test/a','h','Cobre enchente','HIGH')
       returning id`, [ids.org, ids.ws]);
    await db.query(
      `insert into mkt.claims (org_id, content_version_id, text, material, claim_type, evidence_ids)
       values ($1,$2,'Cobre alagamento.',true,'COVERAGE',array[$3::uuid])`,
      [ids.org, cvid, ev.rows[0].id]);
    await db.query(`delete from mkt.evidence where id = $1`, [ev.rows[0].id]);
  }
  return cvid;
}

before(async () => {
  await db.connect();
  await limpar();
  ports = createPostgresPorts(db);
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
    with o as (insert into mkt.organizations (name, slug) values ('Rev','rev-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name)
    select w.org_id, w.id, 'Marca' from w returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;
});

after(async () => { await limpar(); await db.end(); });

// ── O beco que existia ──────────────────────────────────────────────────────

test("um DRAFT continua sem alcancar revisao humana direto", async () => {
  // Nao e regressao: e a J11. O que mudou nao foi a state machine — foi passar
  // a existir um jeito de cumprir a etapa que faltava.
  const cvid = await conteudo();
  const r = await gateway.execute(
    pedido("approval.request", { content_version_id: cvid, reason_codes: [] }), contexto());

  assert.equal(r.execution.status, "FAILED");
  assert.equal(r.execution.error.reason_code, "CONTENT_NOT_APPROVED");
  assert.match(r.execution.error.provider_message ?? "", /AI_REVIEW/);
  assert.equal(await estadoDe(cvid), "DRAFT");
});

// ── A etapa que passou a existir ────────────────────────────────────────────

test("o laudo que passa move o conteudo para AI_REVIEW", async () => {
  const cvid = await conteudo();
  const r = await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());

  assert.equal(r.execution.status, "SUCCEEDED", JSON.stringify(r.execution.error));
  assert.equal(r.output.valid, true);
  assert.equal(await estadoDe(cvid), "AI_REVIEW");
});

test("o estado nao entra sozinho: o laudo fica gravado junto", async () => {
  // AI_REVIEW sem o que a IA conferiu e confianca sem lastro — que e
  // exatamente o que este produto existe para nao produzir.
  const cvid = await conteudo();
  await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());

  const eventos = await eventosDe(cvid);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].event_type, "olga/content.ai_review.passed");
  assert.equal(eventos[0].actor_type, "agent");
  assert.equal(eventos[0].trace_id, "tr_rev");
  assert.ok(eventos[0].properties.checks.some((c) => c.check === "claims_supported"));
});

test("depois da revisao de IA, pedir aprovacao funciona", async () => {
  // A cadeia editorial inteira, que ate agora nao fechava:
  // DRAFT -> AI_REVIEW -> HUMAN_REVIEW.
  const cvid = await conteudo();
  await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());

  const r = await gateway.execute(
    pedido("approval.request", { content_version_id: cvid, reason_codes: [] }), contexto());

  assert.equal(r.execution.status, "SUCCEEDED", JSON.stringify(r.execution.error));
  assert.equal(await estadoDe(cvid), "HUMAN_REVIEW");
});

test("claim de cobertura leva para revisao de compliance, e nao para a fila comum", async () => {
  const cvid = await conteudo();
  await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());

  await gateway.execute(
    pedido("approval.request", {
      content_version_id: cvid, reason_codes: ["COMPLIANCE_REVIEW_REQUIRED"],
    }), contexto());

  assert.equal(await estadoDe(cvid), "COMPLIANCE_REVIEW");
});

// ── O laudo que reprova ─────────────────────────────────────────────────────

test("claim sem lastro nao passa, e o conteudo fica onde estava", async () => {
  const cvid = await conteudo({ claimSemLastro: true });
  const r = await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());

  // Achar problema e a capability funcionando: a execucao teve sucesso e o
  // laudo e que reprova.
  assert.equal(r.execution.status, "SUCCEEDED");
  assert.equal(r.output.valid, false);
  assert.ok(r.output.reason_codes.includes("CLAIM_UNSUPPORTED"));

  assert.equal(await estadoDe(cvid), "DRAFT");
  assert.deepEqual(await eventosDe(cvid), [], "nao se registra revisao que nao aconteceu");
});

test("texto duplicado tambem segura, e diz qual e o outro", async () => {
  const corpo = "Exatamente o mesmo texto, palavra por palavra.";
  const primeiro = await conteudo({ corpo });
  await gateway.execute(pedido("quality.ai_review", { content_version_id: primeiro }), contexto());

  const segundo = await conteudo({ corpo });
  const r = await gateway.execute(pedido("quality.ai_review", { content_version_id: segundo }), contexto());

  assert.equal(r.output.valid, false);
  assert.ok(r.output.reason_codes.includes("CONTENT_DUPLICATE_RISK"));
  assert.equal(await estadoDe(segundo), "DRAFT");
});

// ── Repetir ─────────────────────────────────────────────────────────────────

test("rodar a revisao duas vezes nao registra que passou duas vezes", async () => {
  // O loop pode ser reexecutado. A segunda passada nao pode virar um segundo
  // evento dizendo que a IA revisou de novo.
  const cvid = await conteudo();
  await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());
  const r = await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());

  assert.equal(r.execution.status, "SUCCEEDED");
  assert.equal(await estadoDe(cvid), "AI_REVIEW");
  assert.equal((await eventosDe(cvid)).length, 1);
});

test("conteudo que ja passou da etapa e recusa nomeada, nao erro de trigger", async () => {
  const cvid = await conteudo();
  await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());
  await db.query(`update mkt.content_versions set state = 'APPROVED' where id = $1`, [cvid]);

  const r = await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());
  assert.equal(r.execution.status, "FAILED");
  assert.equal(r.execution.error.reason_code, "CONTENT_NOT_APPROVED");
  assert.equal(await estadoDe(cvid), "APPROVED");
});

// ── As duas capabilities sobre a mesma conferencia ──────────────────────────

test("o precheck confere e nao move; a revisao confere e move", async () => {
  const cvid = await conteudo();

  const pre = await gateway.execute(
    pedido("quality.precheck", { content_version_id: cvid }, "simulate"), contexto());
  assert.equal(pre.output.valid, true);
  assert.equal(await estadoDe(cvid), "DRAFT", "simulate nao produz efeito, e isso e o contrato dele");

  const rev = await gateway.execute(pedido("quality.ai_review", { content_version_id: cvid }), contexto());
  assert.deepEqual(rev.output.checks, pre.output.checks, "a conferencia e a mesma funcao");
  assert.equal(await estadoDe(cvid), "AI_REVIEW");
});

test("o registry declara as duas com modos diferentes, e e disso que tudo depende", async () => {
  const pre = await ports.registry.getCapability("quality.precheck", 1);
  const rev = await ports.registry.getCapability("quality.ai_review", 1);

  assert.equal(pre.mode, "simulate");
  assert.equal(pre.side_effect, "none");
  assert.equal(rev.mode, "write");
  assert.equal(rev.side_effect, "internal");
  // Um simulate que escreve seria mentira no lugar onde a policy decide, o
  // gateway roteia e os evals conferem.
  assert.equal(rev.output_schema_ref, "olga://io/validated-result");
});
