import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublishWorkflow } from "../src/publish-workflow.mjs";
import { createGateway } from "@olga/gateway";

const ORG = "11111111-1111-1111-1111-111111111111";
const WS = "22222222-2222-2222-2222-222222222222";

const CAP = {
  capability_id: "publishing.publish", version: 1, status: "ACTIVE", mode: "write",
  side_effect: "external", risk_tier: "MEDIUM", permissions: ["OWNER", "MARKETING"],
  provider_adapter: "meta_graph", max_attempts: 1,
  idempotency: { required: true, key_template: "{workspace_id}:{content_version_id}:{channel}:{connection_id}" },
};
const POL = {
  policy_id: "POL_PUBLISH", version: 1, status: "ACTIVE", priority: 500,
  scope: { capability_id: "publishing.publish" },
  conditions: [{ fact: "channel_connected", op: "is_true", value: true }],
  effect: "ALLOW", max_autonomy: "A3",
};

const EVENT = {
  org_id: ORG, workspace_id: WS, content_version_id: "cv1", channel: "INSTAGRAM",
  connection_id: "conn1", channel_variant_id: "var1", trace_id: "tr_wf",
  requested_autonomy: "A3", actor: { role: "OWNER", org_id: ORG },
};

function build({ facts, adapterCalls = [] } = {}) {
  const receiptsStore = [];
  const domain = { published: [], blocked: [], failed: [], runs: {} };
  let seq = 0;

  const gateway = createGateway({
    registry: {
      getCapability: async () => CAP,
      newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    },
    policies: { listActive: async () => [POL] },
    receipts: {
      find: async (o, c, k) => receiptsStore.find((r) => r.idempotency_key === k) ?? null,
      save: async (r) => { receiptsStore.push(r); },
    },
    adapters: {
      meta_graph: { call: async ({ idempotency_key }) => { adapterCalls.push(idempotency_key); return { external_id: `ig_${adapterCalls.length}` }; } },
    },
  });

  const db = {
    getCapability: async () => CAP,
    collectPublishFacts: async () => facts ?? {
      channel_connected: true, content_status: "APPROVED", brand_brain_status: "ACTIVE",
      evidence_coverage: true, workspace_first_publish: false, claim_types: ["GENERAL"],
    },
    upsertWorkflowRun: async (r) => { domain.runs[r.trace_id] = { ...r }; },
    updateWorkflowRun: async (t, patch) => { domain.runs[t] = { ...(domain.runs[t] ?? {}), ...patch }; },
    markPublished: async (p) => { domain.published.push(p); },
    markBlocked: async (p) => { domain.blocked.push(p); },
    markFailed: async (p) => { domain.failed.push(p); },
  };

  return { wf: createPublishWorkflow({ gateway, db }), domain, adapterCalls, receiptsStore };
}

/** Step falso: executa de verdade e memoriza, como um motor durável. */
function durableStep(memo = {}) {
  return {
    memo,
    run: async (name, fn) => {
      if (name in memo) return memo[name];   // checkpoint: não reexecuta
      const out = await fn();
      memo[name] = out;
      return out;
    },
  };
}

/** Step que crasha depois de N etapas, para simular queda no meio do voo. */
function crashingStep(afterSteps, memo = {}) {
  let n = 0;
  return {
    memo,
    run: async (name, fn) => {
      if (name in memo) return memo[name];
      if (n++ >= afterSteps) throw new Error("WORKER_CRASH");
      const out = await fn();
      memo[name] = out;
      return out;
    },
  };
}

test("publica e registra o external_id no dominio", async () => {
  const { wf, domain, adapterCalls } = build();
  const r = await wf(EVENT, durableStep());
  assert.equal(r.status, "SUCCEEDED");
  assert.equal(domain.published.length, 1);
  assert.equal(domain.published[0].external_id, "ig_1");
  assert.equal(domain.runs.tr_wf.current_state, "PUBLISHED");
  assert.equal(adapterCalls.length, 1);
});

test("GATE G1 — replay do workflow inteiro não publica de novo", async () => {
  const shared = { adapterCalls: [] };
  const { wf, domain, adapterCalls, receiptsStore } = build(shared);

  // Primeira execução, com memo próprio.
  await wf(EVENT, durableStep());
  // Replay: motor reexecuta do zero, memo vazio, mesmos dados.
  const segundo = await wf(EVENT, durableStep());

  assert.equal(segundo.status, "DEDUPLICATED");
  assert.equal(adapterCalls.length, 1, "o provider foi chamado duas vezes — post duplicado");
  assert.equal(receiptsStore.length, 1, "dois receipts para o mesmo efeito");
  assert.equal(domain.published.length, 2, "o dominio reflete as duas passagens...");
  assert.equal(domain.published[1].deduplicated, true, "...mas a segunda marcada como dedup");
});

test("crash no meio e retomada não geram efeito duplicado", async () => {
  const shared = { adapterCalls: [] };
  const { wf, adapterCalls, receiptsStore } = build(shared);
  const memo = {};

  // Crasha depois de duas etapas — antes de executar a publicação.
  await assert.rejects(() => wf(EVENT, crashingStep(2, memo)), /WORKER_CRASH/);
  assert.equal(adapterCalls.length, 0, "nada deveria ter sido publicado ainda");

  // Retoma do checkpoint.
  const r = await wf(EVENT, durableStep(memo));
  assert.equal(r.status, "SUCCEEDED");
  assert.equal(adapterCalls.length, 1);
  assert.equal(receiptsStore.length, 1);
});

test("bloqueio de policy não vira retry nem dead-letter", async () => {
  const { wf, domain, adapterCalls } = build({
    facts: { channel_connected: true, content_status: "DRAFT", brand_brain_status: "ACTIVE",
             evidence_coverage: true, workspace_first_publish: false, claim_types: ["GENERAL"] },
  });
  const r = await wf(EVENT, durableStep());
  assert.equal(r.status, "BLOCKED");
  assert.equal(domain.blocked.length, 1);
  assert.equal(domain.blocked[0].reason_code, "CONTENT_NOT_APPROVED");
  assert.equal(domain.runs.tr_wf.current_state, "FAILED");
  assert.notEqual(domain.runs.tr_wf.dead_lettered, true, "rejeicao editorial nao e dead-letter");
  assert.equal(adapterCalls.length, 0);
});

test("canal desconectado bloqueia antes de qualquer chamada externa", async () => {
  const { wf, adapterCalls, domain } = build({
    facts: { channel_connected: false, content_status: "APPROVED", brand_brain_status: "ACTIVE",
             evidence_coverage: true, workspace_first_publish: false, claim_types: ["GENERAL"] },
  });
  const r = await wf(EVENT, durableStep());
  assert.equal(r.status, "BLOCKED");
  assert.equal(adapterCalls.length, 0);
  assert.ok(domain.blocked[0].reason_code);
});
