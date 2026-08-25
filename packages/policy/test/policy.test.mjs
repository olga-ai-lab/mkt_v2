import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate, minAutonomy, INVARIANTS } from "../src/index.mjs";
import { validate } from "@olga/contracts";

const publishCtx = { capability_id: "publishing.publish", capability_mode: "write", channel: "INSTAGRAM", agent_id: "AGT-MKT-CONTENT", risk_tier: "LOW" };

const allowPublish = {
  policy_id: "POL_PUBLISH_SOCIAL", version: 1, status: "ACTIVE", priority: 100,
  scope: { capability_id: "publishing.publish" },
  conditions: [{ fact: "channel_connected", op: "is_true", value: true }],
  effect: "ALLOW", max_autonomy: "A4", message_key: "policy.publish_allowed",
};

const happyFacts = {
  channel_connected: true, content_status: "APPROVED", brand_brain_status: "ACTIVE",
  evidence_coverage: true, workspace_first_publish: false, claim_types: ["GENERAL"],
};

test("saida do engine e um RespondabilityResult valido pelo schema", () => {
  const r = evaluate({ context: publishCtx, facts: happyFacts, requested_autonomy: "A3", policies: [allowPublish] });
  const { valid, errors } = validate("olga://io/respondability-result", r);
  assert.equal(valid, true, JSON.stringify(errors));
});

test("default deny: capability de escrita sem policy ACTIVE e bloqueada", () => {
  const r = evaluate({ context: publishCtx, facts: happyFacts, requested_autonomy: "A2", policies: [] });
  assert.equal(r.state, "POLICY_BLOCKED");
  assert.ok(r.reason_codes.includes("NO_ACTIVE_POLICY"));
  assert.equal(r.granted_autonomy, null);
});

test("policy em CANDIDATE nao dirige producao", () => {
  const candidate = { ...allowPublish, status: "CANDIDATE" };
  const r = evaluate({ context: publishCtx, facts: happyFacts, requested_autonomy: "A2", policies: [candidate] });
  assert.equal(r.state, "POLICY_BLOCKED");
  assert.ok(r.reason_codes.includes("NO_ACTIVE_POLICY"));
});

test("leitura nao exige policy explicita", () => {
  const r = evaluate({ context: { ...publishCtx, capability_id: "brand.read", capability_mode: "read" }, facts: happyFacts, requested_autonomy: "A1", policies: [] });
  assert.equal(r.state, "EXECUTABLE");
});

test("caminho feliz concede a autonomia pedida", () => {
  const r = evaluate({ context: publishCtx, facts: happyFacts, requested_autonomy: "A3", policies: [allowPublish] });
  assert.equal(r.state, "EXECUTABLE");
  assert.equal(r.granted_autonomy, "A3");
  assert.equal(r.required_approval, false);
});

test("risco HIGH limita a A2 mesmo com policy pedindo A4", () => {
  const r = evaluate({ context: { ...publishCtx, risk_tier: "HIGH" }, facts: happyFacts, requested_autonomy: "A4", policies: [allowPublish] });
  assert.equal(r.granted_autonomy, "A2");
  assert.ok(r.reason_codes.includes("AUTONOMY_EXCEEDED"));
  assert.equal(r.state, "APPROVAL_REQUIRED", "efeito externo acima do teto vira aprovacao, nao rebaixamento silencioso");
});

test("primeira publicacao do workspace nunca sai em A4", () => {
  const r = evaluate({ context: publishCtx, facts: { ...happyFacts, workspace_first_publish: true }, requested_autonomy: "A4", policies: [allowPublish] });
  assert.ok(["A0","A1","A2","A3"].includes(r.granted_autonomy));
  assert.notEqual(r.granted_autonomy, "A4");
  assert.ok(r.reason_codes.includes("WORKSPACE_FIRST_PUBLISH"));
});

test("claim de cobertura derruba o teto para A2 e exige compliance", () => {
  const r = evaluate({ context: publishCtx, facts: { ...happyFacts, claim_types: ["COVERAGE"] }, requested_autonomy: "A4", policies: [allowPublish] });
  assert.ok(r.reason_codes.includes("COMPLIANCE_REVIEW_REQUIRED"));
  assert.equal(r.granted_autonomy, "A2");
});

test("claim de preco tambem derruba para A2", () => {
  const r = evaluate({ context: publishCtx, facts: { ...happyFacts, claim_types: ["PRICE"] }, requested_autonomy: "A3", policies: [allowPublish] });
  assert.equal(r.granted_autonomy, "A2");
});

test("consent ausente zera a autonomia em qualquer canal", () => {
  const r = evaluate({
    context: { ...publishCtx, capability_id: "messaging.send", channel: "WHATSAPP" },
    facts: { ...happyFacts, consent_status: "REVOKED" },
    requested_autonomy: "A2",
    policies: [{ ...allowPublish, scope: { capability_id: "messaging.send" } }],
  });
  assert.ok(r.reason_codes.includes("CONSENT_MISSING"));
  assert.equal(r.granted_autonomy, "A0");
});

test("canal desconectado impede efeito externo", () => {
  const r = evaluate({ context: publishCtx, facts: { ...happyFacts, channel_connected: false }, requested_autonomy: "A3", policies: [allowPublish] });
  assert.ok(r.reason_codes.includes("CHANNEL_NOT_CONNECTED"));
  assert.ok(["A0", "A1"].includes(r.granted_autonomy ?? "A0"));
});

test("conteudo em DRAFT nao publica", () => {
  const r = evaluate({ context: publishCtx, facts: { ...happyFacts, content_status: "DRAFT" }, requested_autonomy: "A3", policies: [allowPublish] });
  assert.ok(r.reason_codes.includes("CONTENT_NOT_APPROVED"));
  assert.equal(r.granted_autonomy, "A2");
});

test("Brand Brain apenas CANDIDATE limita o agente a rascunho", () => {
  const r = evaluate({ context: publishCtx, facts: { ...happyFacts, brand_brain_status: "CANDIDATE" }, requested_autonomy: "A4", policies: [allowPublish] });
  assert.ok(r.reason_codes.includes("BRAND_BRAIN_NOT_ACTIVE"));
  assert.equal(r.granted_autonomy, "A2");
});

test("policy BLOCK vence e devolve o reason code do dado", () => {
  const block = {
    policy_id: "POL_BLOCK_WA", version: 3, status: "ACTIVE", priority: 10,
    scope: { channel: "WHATSAPP" },
    conditions: [], effect: "BLOCK", reason_code: "UNSUPPORTED_CAMPAIGN_ACTION",
  };
  const r = evaluate({ context: { ...publishCtx, channel: "WHATSAPP" }, facts: happyFacts, requested_autonomy: "A2", policies: [block, allowPublish] });
  assert.equal(r.state, "POLICY_BLOCKED");
  assert.ok(r.reason_codes.includes("UNSUPPORTED_CAMPAIGN_ACTION"));
});

test("prioridade menor vence: a primeira correspondencia decide", () => {
  const restritiva = { ...allowPublish, policy_id: "POL_A", priority: 1, effect: "REQUIRE_APPROVAL", reason_code: "COMPLIANCE_REVIEW_REQUIRED" };
  const permissiva = { ...allowPublish, policy_id: "POL_B", priority: 900, effect: "ALLOW", max_autonomy: "A4" };
  const r = evaluate({ context: publishCtx, facts: happyFacts, requested_autonomy: "A4", policies: [permissiva, restritiva] });
  assert.equal(r.state, "APPROVAL_REQUIRED");
  assert.equal(r.policy_versions.at(-1).policy_id, "POL_A");
});

test("policy nao consegue conceder mais autonomia que o teto de risco", () => {
  const generosa = { ...allowPublish, max_autonomy: "A4" };
  const r = evaluate({ context: { ...publishCtx, risk_tier: "MEDIUM" }, facts: happyFacts, requested_autonomy: "A4", policies: [generosa] });
  assert.notEqual(r.granted_autonomy, "A4");
  assert.equal(r.granted_autonomy, "A3");
});

test("fato fora do enum fechado explode em vez de passar batido", () => {
  const suja = { ...allowPublish, conditions: [{ fact: "lua_cheia", op: "is_true", value: true }] };
  assert.throws(() => evaluate({ context: publishCtx, facts: happyFacts, policies: [suja] }), /fato desconhecido/);
});

test("minAutonomy sempre devolve a mais restritiva", () => {
  assert.equal(minAutonomy("A4", "A2"), "A2");
  assert.equal(minAutonomy("A0", "A3"), "A0");
  assert.equal(minAutonomy(null, "A3"), "A3");
});

test("todo invariante declara reason code e nota", () => {
  for (const inv of INVARIANTS) {
    assert.ok(inv.id && inv.reason_code && inv.note && inv.ceiling, `invariante incompleto: ${inv.id}`);
  }
});
