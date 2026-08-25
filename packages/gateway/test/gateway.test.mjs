import { test } from "node:test";
import assert from "node:assert/strict";
import { createGateway, buildIdempotencyKey, CapabilityError } from "../src/index.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const WS  = "22222222-2222-2222-2222-222222222222";

const PUBLISH = {
  capability_id: "publishing.publish", version: 1, status: "ACTIVE", mode: "write",
  side_effect: "external", risk_tier: "MEDIUM", max_autonomy: "A4",
  permissions: ["OWNER", "MARKETING"], provider_adapter: "meta_graph",
  idempotency: { required: true, key_template: "{workspace_id}:{content_version_id}:{channel}:{connection_id}" },
  retry_policy: { max_attempts: 3 },
};
const DRAFT = {
  capability_id: "content.create_draft", version: 1, status: "ACTIVE", mode: "write",
  side_effect: "internal", risk_tier: "LOW", permissions: ["OWNER", "MARKETING"],
  provider_adapter: "internal",
};

const ALLOW_PUBLISH = {
  policy_id: "POL_PUBLISH", version: 1, status: "ACTIVE", priority: 500,
  scope: { capability_id: "publishing.publish" },
  conditions: [{ fact: "channel_connected", op: "is_true", value: true }],
  effect: "ALLOW", max_autonomy: "A3",
};
const ALLOW_DRAFT = {
  policy_id: "POL_DRAFT", version: 1, status: "ACTIVE", priority: 600,
  scope: { capability_id: "content.create_draft" }, conditions: [], effect: "ALLOW", max_autonomy: "A2",
};

const HAPPY = {
  channel_connected: true, content_status: "APPROVED", brand_brain_status: "ACTIVE",
  evidence_coverage: true, workspace_first_publish: false, claim_types: ["GENERAL"],
};

function harness({ caps = [PUBLISH, DRAFT], pols = [ALLOW_PUBLISH, ALLOW_DRAFT], adapter } = {}) {
  const saved = [];
  let seq = 0;
  const calls = [];
  const events = [];
  const gw = createGateway({
    registry: {
      getCapability: async (id, v) => caps.find((c) => c.capability_id === id && c.version === v) ?? null,
      newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    },
    policies: { listActive: async () => pols },
    receipts: {
      find: async (org, cap, key) => saved.find((r) => r.tenant.org_id === org && r.capability_id === cap && r.idempotency_key === key) ?? null,
      save: async (r) => { saved.push(r); },
    },
    adapters: {
      meta_graph: adapter ?? { call: async ({ idempotency_key }) => { calls.push(idempotency_key); return { external_id: `ig_${calls.length}`, request_hash: "h1" }; } },
      internal: { call: async () => { calls.push("internal"); return {}; } },
    },
    tracer: { event: (e) => events.push(e) },
  });
  return { gw, saved, calls, events };
}

const req = (over = {}) => ({
  trace_id: "tr_1",
  tenant: { org_id: ORG, workspace_id: WS },
  capability_id: "publishing.publish", capability_version: 1, mode: "write",
  args: { channel: "INSTAGRAM", content_version_id: "cv1", connection_id: "conn1" },
  idempotency_key: `${WS}:cv1:INSTAGRAM:conn1`,
  requested_autonomy: "A3",
  ...over,
});

const OWNER = { role: "OWNER", org_id: ORG };

test("caminho feliz: publica, devolve external_id e emite receipt", async () => {
  const { gw, saved } = harness();
  const { execution, receipt, respondability } = await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  assert.equal(respondability.state, "EXECUTABLE");
  assert.equal(execution.status, "SUCCEEDED");
  assert.equal(execution.external_id, "ig_1");
  assert.equal(saved.length, 1);
  assert.equal(receipt.status, "EFFECTED");
  assert.equal(receipt.autonomy_used, "A3");
});

test("REPLAY NAO DUPLICA: segunda chamada com a mesma chave nao toca o provider", async () => {
  const { gw, saved, calls } = harness();
  const first = await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  const second = await gw.execute(req(), { facts: HAPPY, actor: OWNER });

  assert.equal(first.execution.status, "SUCCEEDED");
  assert.equal(second.execution.status, "DEDUPLICATED");
  assert.equal(calls.length, 1, "o provider foi chamado duas vezes — efeito duplicado");
  assert.equal(saved.length, 1, "dois receipts para o mesmo efeito");
  assert.equal(second.execution.external_id, first.execution.external_id,
    "o replay deve devolver o mesmo external_id do efeito original");
});

test("replay de dez tentativas continua com um unico efeito", async () => {
  const { gw, calls, saved } = harness();
  for (let i = 0; i < 10; i++) await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  assert.equal(calls.length, 1);
  assert.equal(saved.length, 1);
});

test("chave diferente e efeito diferente: nao ha dedup indevido", async () => {
  const { gw, calls } = harness();
  await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  await gw.execute(req({ idempotency_key: `${WS}:cv2:INSTAGRAM:conn1`, args: { channel: "INSTAGRAM", content_version_id: "cv2", connection_id: "conn1" } }),
    { facts: HAPPY, actor: OWNER });
  assert.equal(calls.length, 2);
});

test("default deny: sem policy ACTIVE o efeito externo nao acontece", async () => {
  const { gw, calls } = harness({ pols: [] });
  const { execution, respondability } = await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  assert.equal(respondability.state, "POLICY_BLOCKED");
  assert.equal(execution.status, "BLOCKED");
  assert.ok(execution.error.reason_code);
  assert.equal(calls.length, 0, "o provider foi chamado apesar do bloqueio");
});

test("policy que exige aprovacao bloqueia enquanto nao houver approval_id", async () => {
  const exige = { ...ALLOW_PUBLISH, effect: "REQUIRE_APPROVAL", reason_code: "COMPLIANCE_REVIEW_REQUIRED" };
  const { gw, calls } = harness({ pols: [exige] });
  const semAprovacao = await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  assert.equal(semAprovacao.execution.status, "BLOCKED");
  assert.equal(calls.length, 0);

  const comAprovacao = await gw.execute(req({ approval_id: "33333333-3333-3333-3333-333333333333" }),
    { facts: HAPPY, actor: OWNER });
  assert.equal(comAprovacao.execution.status, "SUCCEEDED");
  assert.equal(comAprovacao.receipt.approval_id, "33333333-3333-3333-3333-333333333333");
});

test("conteudo nao aprovado nao publica, mesmo com policy permissiva", async () => {
  const { gw, calls } = harness();
  const { execution } = await gw.execute(req(), { facts: { ...HAPPY, content_status: "DRAFT" }, actor: OWNER });
  assert.equal(execution.status, "BLOCKED");
  assert.equal(calls.length, 0);
});

test("papel sem permissao e recusado antes da policy", async () => {
  const { gw, calls } = harness();
  await assert.rejects(
    () => gw.execute(req(), { facts: HAPPY, actor: { role: "APPROVER", org_id: ORG } }),
    (e) => e.reason_code === "ACTOR_ROLE_FORBIDDEN",
  );
  assert.equal(calls.length, 0);
});

test("ator de outro tenant e recusado", async () => {
  const { gw } = harness();
  await assert.rejects(
    () => gw.execute(req(), { facts: HAPPY, actor: { role: "OWNER", org_id: "99999999-9999-9999-9999-999999999999" } }),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION",
  );
});

test("capability CANDIDATE nao executa", async () => {
  const { gw } = harness({ caps: [{ ...PUBLISH, status: "CANDIDATE" }] });
  await assert.rejects(() => gw.execute(req(), { facts: HAPPY, actor: OWNER }),
    (e) => e.reason_code === "CAPABILITY_NOT_ACTIVE");
});

test("request que nao bate com o schema nem chega no registry", async () => {
  const { gw } = harness();
  await assert.rejects(
    () => gw.execute({ ...req(), idempotency_key: undefined }, { facts: HAPPY, actor: OWNER }),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED",
  );
});

test("erro transitorio faz retry ate o limite e depois falha com receipt FAILED", async () => {
  let n = 0;
  const adapter = { call: async () => { n++; const e = new CapabilityError("PROVIDER_RATE_LIMITED"); e.error_class = "TRANSIENT"; e.retryable = true; throw e; } };
  const { gw, saved } = harness({ adapter });
  const { execution } = await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  assert.equal(n, 3, "deveria tentar tres vezes (max_attempts)");
  assert.equal(execution.status, "FAILED");
  assert.equal(execution.attempts, 3);
  assert.equal(execution.error.reason_code, "PROVIDER_RATE_LIMITED");
  assert.equal(saved[0].status, "FAILED", "falha material tambem produz receipt");
});

test("erro permanente nao insiste", async () => {
  let n = 0;
  const adapter = { call: async () => { n++; const e = new CapabilityError("CONTENT_NOT_APPROVED"); e.error_class = "PERMANENT"; e.retryable = false; throw e; } };
  const { gw } = harness({ adapter });
  const { execution } = await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  assert.equal(n, 1);
  assert.equal(execution.attempts, 1);
});

test("erro desconhecido do provider nunca vira sucesso", async () => {
  const adapter = { call: async () => { throw new Error("kaboom"); } };
  const { gw } = harness({ adapter });
  const { execution } = await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  assert.equal(execution.status, "FAILED");
  assert.equal(execution.error.class, "PERMANENT");
  assert.equal(execution.error.retryable, false);
});

test("capability interna nao emite receipt nem exige idempotencia", async () => {
  const { gw, saved } = harness();
  const r = await gw.execute({
    trace_id: "tr_2", tenant: { org_id: ORG, workspace_id: WS },
    capability_id: "content.create_draft", capability_version: 1, mode: "write",
    args: {}, idempotency_key: "nao-usada-aqui", requested_autonomy: "A2",
  }, { facts: HAPPY, actor: OWNER });
  assert.equal(r.execution.status, "SUCCEEDED");
  assert.equal(r.receipt, undefined);
  assert.equal(saved.length, 0);
});

test("capability externa declarada sem idempotencia e recusada pelo gateway", async () => {
  const quebrada = { ...PUBLISH, idempotency: { required: false } };
  const { gw } = harness({ caps: [quebrada] });
  await assert.rejects(() => gw.execute(req(), { facts: HAPPY, actor: OWNER }),
    /sem idempotencia declarada/);
});

test("a autonomia gravada no receipt nunca passa do teto da capability", async () => {
  const teto = { ...PUBLISH, max_autonomy: "A2" };
  const permissiva = { ...ALLOW_PUBLISH, max_autonomy: "A4" };
  const { gw } = harness({ caps: [teto], pols: [permissiva] });
  const { receipt } = await gw.execute(req({ requested_autonomy: "A2" }), { facts: HAPPY, actor: OWNER });
  assert.equal(receipt.autonomy_used, "A2");
});

test("buildIdempotencyKey exige todos os campos do template", () => {
  const t = "{workspace_id}:{content_version_id}:{channel}:{connection_id}";
  assert.equal(buildIdempotencyKey(t, { workspace_id: "w", content_version_id: "c", channel: "INSTAGRAM", connection_id: "x" }),
    "w:c:INSTAGRAM:x");
  assert.throws(() => buildIdempotencyKey(t, { workspace_id: "w" }), (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED");
});

test("o trace registra dedup e conclusao", async () => {
  const { gw, events } = harness();
  await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  await gw.execute(req(), { facts: HAPPY, actor: OWNER });
  assert.ok(events.some((e) => e.event === "capability.completed"));
  assert.ok(events.some((e) => e.event === "capability.deduplicated"));
});
