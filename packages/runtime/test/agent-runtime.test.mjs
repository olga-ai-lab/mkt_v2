import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentRuntime } from "../src/agent-runtime.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const WS  = "22222222-2222-2222-2222-222222222222";
const OUTRA_ORG = "99999999-9999-9999-9999-999999999999";

const CONTENT = {
  agent_id: "AGT-MKT-CONTENT", version: 1, status: "ACTIVE",
  mission: "Criar master content e variantes por canal.",
  baseline_autonomy: "A2", max_autonomy: "A3",
  capabilities: ["content.create_draft"],
  model_profile: { task_class: "copywriting", max_cost_cents_per_run: 40 },
};

function harness({ agent = CONTENT, model, workspaceOk = true } = {}) {
  const started = [], finished = [], events = [];
  let n = 0;
  const rt = createAgentRuntime({
    modelGateway: {
      complete: model ?? (async () => ({
        provider: "anthropic", model: "claude-x", model_profile_version: 1,
        content: JSON.stringify({ message: "rascunho pronto", next_step: "revise e aprove" }),
        parsed: { message: "rascunho pronto", next_step: "revise e aprove" },
        input_tokens: 1200, output_tokens: 800, cost_cents: 3.6, latency_ms: 900,
        fallback_used: false, fallback_reason: null,
      })),
    },
    registry: {
      getAgent: async (id) => (agent && agent.agent_id === id ? agent : null),
      workspaceBelongsToOrg: async () => workspaceOk,
    },
    runs: {
      start: async (r) => { started.push(r); },
      finish: async (id, patch) => { finished.push({ id, ...patch }); },
    },
    tracer: { event: (e) => events.push(e) },
    ids: { newId: () => `run_${++n}`, newTraceId: () => `tr_${n}` },
  });
  return { rt, started, finished, events };
}

const req = (o = {}) => ({
  tenant: { org_id: ORG, workspace_id: WS },
  actor: { id: "u1", role: "MARKETING", org_id: ORG },
  agent_id: "AGT-MKT-CONTENT",
  input: { text: "escreve um post sobre renovacao de frota" },
  ...o,
});

test("caminho feliz grava o run com custo, tokens e latencia", async () => {
  const { rt, started, finished } = harness();
  const r = await rt.run(req());
  assert.equal(started.length, 1);
  assert.equal(started[0].status, "RUNNING");
  assert.equal(finished[0].status, "SUCCEEDED");
  assert.equal(finished[0].cost_cents, 3.6);
  assert.equal(finished[0].input_tokens, 1200);
  assert.equal(finished[0].model, "anthropic:claude-x");
  assert.ok(r.response.next_step);
});

test("a resposta obedece o schema FinalResponse", async () => {
  const { rt } = harness();
  const r = await rt.run(req());
  assert.equal(r.response.respondability, "EXECUTABLE");
  assert.equal(r.response.autonomy_mode, "GOVERNED_EXECUTE");
});

test("TENANT NAO VEM DO INPUT: tentar injetar org_id e violacao", async () => {
  const { rt, started } = harness();
  await assert.rejects(
    () => rt.run(req({ input: { text: "oi", org_id: OUTRA_ORG } })),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION",
  );
  assert.equal(started.length, 0, "nem chegou a abrir run");
});

test("tentar injetar workspace_id pelo input tambem e violacao", async () => {
  const { rt } = harness();
  await assert.rejects(
    () => rt.run(req({ input: { text: "oi", workspace_id: "outro" } })),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION",
  );
});

test("ator de outra org nao roda no tenant da sessao", async () => {
  const { rt } = harness();
  await assert.rejects(
    () => rt.run(req({ actor: { id: "u2", role: "OWNER", org_id: OUTRA_ORG } })),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION",
  );
});

test("workspace que nao pertence a org e recusado", async () => {
  const { rt } = harness({ workspaceOk: false });
  await assert.rejects(() => rt.run(req()), (e) => e.reason_code === "TENANT_SCOPE_VIOLATION");
});

test("sem tenant no contexto confiavel nao roda", async () => {
  const { rt } = harness();
  await assert.rejects(() => rt.run(req({ tenant: { org_id: ORG } })),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION");
});

test("agente CANDIDATE nao roda em producao", async () => {
  const { rt } = harness({ agent: { ...CONTENT, status: "CANDIDATE" } });
  await assert.rejects(() => rt.run(req()), (e) => e.reason_code === "AGENT_NOT_ACTIVE");
});

test("agente CANDIDATE roda em modo interno, limitado ao baseline", async () => {
  const { rt, finished } = harness({ agent: { ...CONTENT, status: "CANDIDATE" } });
  const r = await rt.run(req({ internal: true, requested_autonomy: "A3" }));
  assert.equal(r.autonomy_ceiling, "A2", "CANDIDATE nao passa do baseline nem se pedirem A3");
  assert.equal(finished[0].autonomy_used, "A2");
  assert.equal(r.response.autonomy_mode, "DRAFT");
});

test("pedir menos autonomia que o teto e respeitado", async () => {
  const { rt } = harness();
  const r = await rt.run(req({ requested_autonomy: "A1" }));
  assert.equal(r.autonomy_ceiling, "A1");
});

test("agente desconhecido e recusado", async () => {
  const { rt } = harness({ agent: null });
  await assert.rejects(() => rt.run(req()), (e) => e.reason_code === "AGENT_NOT_ACTIVE");
});

test("falha do modelo nao apaga o run: fica registrada com o motivo", async () => {
  const boom = async () => { const e = new Error("caiu"); e.reason_code = "PROVIDER_UNAVAILABLE"; throw e; };
  const { rt, started, finished } = harness({ model: boom });
  await assert.rejects(() => rt.run(req()));
  assert.equal(started.length, 1);
  assert.equal(finished[0].status, "FAILED");
  assert.deepEqual(finished[0].reason_codes, ["PROVIDER_UNAVAILABLE"]);
});

test("estouro de orcamento fica como BLOCKED, nao como FAILED", async () => {
  const semVerba = async () => { const e = new Error("sem verba"); e.reason_code = "SPEND_LIMIT_EXCEEDED"; throw e; };
  const { rt, finished } = harness({ model: semVerba });
  await assert.rejects(() => rt.run(req()));
  assert.equal(finished[0].status, "BLOCKED");
  assert.equal(finished[0].respondability, "POLICY_BLOCKED");
});

test("o teto de custo do agente e repassado ao Model Gateway", async () => {
  let visto = null;
  const espiao = async (r) => {
    visto = r;
    return { provider: "p", model: "m", content: "{}", parsed: { message: "x", next_step: "y" },
             input_tokens: 1, output_tokens: 1, cost_cents: 0.1, latency_ms: 1, fallback_used: false };
  };
  const { rt } = harness({ model: espiao });
  await rt.run(req());
  assert.equal(visto.max_cost_cents, 40);
  assert.equal(visto.task_class, "copywriting");
});

test("ator sem papel nao roda", async () => {
  const { rt } = harness();
  await assert.rejects(() => rt.run(req({ actor: { id: "u" } })),
    (e) => e.reason_code === "ACTOR_ROLE_FORBIDDEN");
});
