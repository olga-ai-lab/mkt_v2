import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allSchemas, ioSchemas, registrySchemas, validate, assertValid,
  AUTONOMY, RESPONDABILITY, REASON_CODES, MAX_AUTONOMY_BY_RISK,
  autonomyAtMost, canTransition, AUTONOMY_SEMANTICS,
} from "../src/index.mjs";

test("todo schema tem $id unico", () => {
  const ids = allSchemas.map((s) => s.$id);
  assert.equal(new Set(ids).size, ids.length, "ha $id duplicado");
  for (const s of allSchemas) assert.ok(s.$id, "schema sem $id");
});

test("os 8 estados de Respondability estao fechados (MKT-SPEC §10)", () => {
  assert.deepEqual(RESPONDABILITY, [
    "EXECUTABLE", "CLARIFICATION_REQUIRED", "UNSUPPORTED", "POLICY_BLOCKED",
    "QUALITY_BLOCKED", "TEMPORARILY_UNAVAILABLE", "APPROVAL_REQUIRED", "HANDOFF_HUMAN",
  ]);
});

test("os niveis A0-A4 existem e tem semantica declarada (fecha G1)", () => {
  assert.deepEqual(AUTONOMY, ["A0", "A1", "A2", "A3", "A4"]);
  for (const lvl of AUTONOMY) {
    const s = AUTONOMY_SEMANTICS[lvl];
    assert.ok(s, `A${lvl} sem semantica`);
    assert.ok(s.name && s.agent && s.human, `${lvl} incompleto`);
    assert.equal(typeof s.writes, "boolean");
    assert.equal(typeof s.external_effect, "boolean");
    assert.ok(Array.isArray(s.requires) && s.requires.length > 0);
  }
});

test("so A3 e A4 produzem efeito externo, e ambos exigem receipt e idempotencia", () => {
  for (const lvl of ["A0", "A1", "A2"]) {
    assert.equal(AUTONOMY_SEMANTICS[lvl].external_effect, false, `${lvl} nao pode ter efeito externo`);
  }
  for (const lvl of ["A3", "A4"]) {
    const req = AUTONOMY_SEMANTICS[lvl].requires;
    assert.ok(req.includes("idempotency_key"), `${lvl} sem idempotency_key`);
    assert.ok(req.includes("action_receipt"), `${lvl} sem action_receipt`);
    assert.ok(req.includes("policy_gate"), `${lvl} sem policy_gate`);
  }
});

test("A4 exige envelope, kill switch, reversao e limite de gasto", () => {
  const req = AUTONOMY_SEMANTICS.A4.requires;
  for (const r of ["declared_envelope", "kill_switch", "post_effect_notification", "reversal_path", "spend_limit"]) {
    assert.ok(req.includes(r), `A4 sem ${r}`);
  }
});

test("matriz risco x autonomia maxima", () => {
  assert.deepEqual(MAX_AUTONOMY_BY_RISK, { LOW: "A4", MEDIUM: "A3", HIGH: "A2" });
  assert.ok(autonomyAtMost("A2", MAX_AUTONOMY_BY_RISK.HIGH));
  assert.ok(!autonomyAtMost("A3", MAX_AUTONOMY_BY_RISK.HIGH));
  assert.ok(!autonomyAtMost("A4", MAX_AUTONOMY_BY_RISK.MEDIUM));
});

test("state machine da J11 nao permite atalho de DRAFT para PUBLISHED", () => {
  assert.ok(canTransition("DRAFT", "AI_REVIEW"));
  assert.ok(canTransition("APPROVED", "SCHEDULED"));
  assert.ok(canTransition("PUBLISHING", "PUBLISHED"));
  assert.ok(!canTransition("DRAFT", "PUBLISHED"));
  assert.ok(!canTransition("DRAFT", "APPROVED"));
  assert.ok(!canTransition("REJECTED", "PUBLISHED"));
  assert.deepEqual(canTransition("PUBLISHED", "DRAFT"), false, "PUBLISHED e terminal");
});

test("CapabilityRequest valido passa", () => {
  const ok = {
    trace_id: "tr_1", tenant: { org_id: "11111111-1111-1111-1111-111111111111", workspace_id: "22222222-2222-2222-2222-222222222222" },
    capability_id: "publishing.publish", capability_version: 1, mode: "write",
    args: { publication_id: "p1" }, idempotency_key: "ws:cv:INSTAGRAM:conn1",
  };
  assert.equal(validate("olga://io/capability-request", ok).valid, true);
});

test("CapabilityRequest sem idempotency_key e rejeitado", () => {
  const bad = {
    trace_id: "tr_1", tenant: { org_id: "11111111-1111-1111-1111-111111111111", workspace_id: "22222222-2222-2222-2222-222222222222" },
    capability_id: "publishing.publish", capability_version: 1, mode: "write", args: {},
  };
  assert.equal(validate("olga://io/capability-request", bad).valid, false);
});

test("mode fora do enum e rejeitado", () => {
  const bad = {
    trace_id: "t", tenant: { org_id: "11111111-1111-1111-1111-111111111111", workspace_id: "22222222-2222-2222-2222-222222222222" },
    capability_id: "publishing.publish", capability_version: 1, mode: "delete",
    args: {}, idempotency_key: "abcdefgh",
  };
  assert.equal(validate("olga://io/capability-request", bad).valid, false);
});

test("capability com efeito externo exige idempotencia declarada", () => {
  const semIdem = {
    capability_id: "publishing.publish", version: 1, status: "ACTIVE", mode: "write",
    side_effect: "external", risk_tier: "MEDIUM",
    input_schema_ref: "olga://io/capability-request", output_schema_ref: "olga://io/execution-result",
    error_codes: ["PROVIDER_RATE_LIMITED"], permissions: ["MARKETING"],
  };
  assert.equal(validate("olga://registry/capability-definition", semIdem).valid, false,
    "efeito externo sem idempotencia deveria falhar");

  const comIdem = { ...semIdem, provider_adapter: "meta_graph",
    idempotency: { required: true, key_template: "{workspace_id}:{content_version_id}:{channel}:{connection_id}" } };
  assert.equal(validate("olga://registry/capability-definition", comIdem).valid, true);
});

test("reason code fora do enum fechado e rejeitado", () => {
  const r = {
    trace_id: "t", state: "POLICY_BLOCKED", reason_codes: ["INVENTEI_UM_CODIGO"],
    evaluated_at: new Date().toISOString(), policy_versions: [],
  };
  assert.equal(validate("olga://io/respondability-result", r).valid, false);
});

test("assertValid lanca com reason_code padronizado", () => {
  assert.throws(() => assertValid("olga://io/final-response", { trace_id: "t" }),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED");
});

test("todo reason code do enum e SCREAMING_SNAKE e unico", () => {
  assert.equal(new Set(REASON_CODES).size, REASON_CODES.length);
  for (const c of REASON_CODES) assert.match(c, /^[A-Z][A-Z0-9_]*$/);
});

test("todo schema de io e registry declara additionalProperties:false", () => {
  for (const s of [...ioSchemas, ...registrySchemas]) {
    assert.equal(s.additionalProperties, false, `${s.$id} aceita campo extra`);
  }
});
