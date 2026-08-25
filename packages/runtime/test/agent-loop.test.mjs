/**
 * O loop de agente — as nove interfaces da Documentação Mestra §6.
 *
 * O que estes testes protegem não é o caminho feliz. É a fronteira: o LLM
 * propõe, o código decide e compila, as ferramentas executam, a evidência
 * sustenta. Cada teste abaixo tenta atravessar essa fronteira por um lado
 * diferente.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAgentLoop, createCompiler, validateResult, buildEvidence } from "../src/agent-loop.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const WS = "22222222-2222-2222-2222-222222222222";
const CV = "33333333-3333-3333-3333-333333333333";

const AGENT = {
  agent_id: "AGT-MKT-CONTENT", version: 1, status: "ACTIVE",
  mission: "Criar master content e variantes.",
  baseline_autonomy: "A2", max_autonomy: "A3",
  capabilities: ["content.create_draft", "publishing.publish"],
  model_profile: { task_class: "copywriting" },
};

const CAP = {
  capability_id: "content.create_draft", version: 1, status: "ACTIVE", mode: "write",
  side_effect: "internal", risk_tier: "LOW", permissions: ["OWNER", "MARKETING"],
  idempotency: { required: false },
};

const POL_ALLOW = {
  policy_id: "P_OK", version: 1, status: "ACTIVE", priority: 500,
  scope: {}, conditions: [], effect: "ALLOW", max_autonomy: "A3",
};

const intentBase = () => ({
  trace_id: "tr_loop", tenant: { org_id: ORG, workspace_id: WS },
  intent: "CREATE_CONTENT", confidence_band: "HIGH",
  entities: [{ type: "content_version", canonical_id: CV, raw: "o post de ontem" }],
  ambiguities: [],
});

const planBase = () => ({
  trace_id: "tr_loop", tenant: { org_id: ORG, workspace_id: WS },
  agent_id: AGENT.agent_id, agent_version: "1",
  steps: [{
    step_id: "s1", capability_id: "content.create_draft", mode: "write",
    args_summary: "criar rascunho para Instagram",
  }],
  expected_outcome: "um rascunho criado",
});

/** Monta o loop com portas falsas e ganchos para inspecao. */
function montar(over = {}) {
  const visto = { compiladoCom: [], executadoCom: [], respondeuCom: [] };

  const compiler = over.compiler ?? createCompiler({
    "content.create_draft": ({ entities, tenant }) => {
      visto.compiladoCom.push({ entities, tenant });
      // Args nascem de entidades resolvidas, nunca de texto do modelo.
      return { content_version_id: entities[0]?.canonical_id, channel: "INSTAGRAM" };
    },
  });

  const gateway = over.gateway ?? {
    execute: async (request) => {
      visto.executadoCom.push(request);
      return {
        respondability: { state: "EXECUTABLE", reason_codes: [], granted_autonomy: "A2" },
        execution: {
          trace_id: request.trace_id, capability_id: request.capability_id,
          status: "SUCCEEDED", provider: null, external_id: null, error: null,
          attempts: 1, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
        },
      };
    },
  };

  const loop = createAgentLoop({
    resolver: { resolve: async () => over.intent ?? intentBase() },
    planner: { plan: async () => over.plan ?? planBase() },
    responder: {
      respond: async (a) => {
        visto.respondeuCom.push(a);
        return over.resposta ?? { message: "Rascunho criado.", next_step: "Revise o texto." };
      },
    },
    retrieval: over.retrieval,
    compiler, gateway,
    registry: {
      getAgent: async () => over.agent ?? AGENT,
      getCapability: async () => over.cap ?? CAP,
      workspaceBelongsToOrg: async () => over.workspaceOk !== false,
    },
    policies: { listActive: async () => over.policies ?? [POL_ALLOW] },
    runs: { start: async () => {}, finish: async () => {} },
    ids: { newId: () => "00000000-0000-4000-8000-000000000001", newTraceId: () => "tr_loop" },
  });

  return { loop, visto, compiler };
}

const pedido = (extra = {}) => ({
  trace_id: "tr_loop",
  tenant: { org_id: ORG, workspace_id: WS },
  actor: { id: "u1", role: "OWNER", org_id: ORG },
  agent_id: "AGT-MKT-CONTENT",
  input: { text: "cria um post sobre seguro residencial" },
  facts: { channel_connected: true },
  ...extra,
});

// ── A fronteira: quem monta os argumentos ───────────────────────────────────

test("os args da capability nascem do compiler, nao do modelo", async () => {
  const { loop, visto } = montar();
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "EXECUTABLE");
  assert.equal(visto.executadoCom.length, 1);
  // O plano só trazia `args_summary`, texto humano. O que chegou ao gateway
  // veio do builder determinístico, a partir da entidade resolvida.
  assert.deepEqual(visto.executadoCom[0].args, { content_version_id: CV, channel: "INSTAGRAM" });
  assert.equal(visto.compiladoCom[0].entities[0].canonical_id, CV);
});

test("capability sem compilador e recusada, nao repassada", async () => {
  // Sem builder, a única alternativa seria usar os args que o modelo escreveu.
  // Recusar é o comportamento seguro; repassar seria o inseguro disfarçado.
  const { loop, visto } = montar({ compiler: createCompiler({}) });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "UNSUPPORTED");
  assert.ok(r.response.reason_codes.includes("UNSUPPORTED_VALUE"));
  assert.equal(visto.executadoCom.length, 0, "nada pode ter sido executado");
});

test("plano com capability fora do charter do agente e recusado", async () => {
  const plan = planBase();
  plan.steps[0].capability_id = "channel.connect";   // nao esta em AGENT.capabilities
  const { loop, visto } = montar({ plan });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "UNSUPPORTED");
  assert.equal(visto.executadoCom.length, 0);
  assert.match(r.response.message, /channel\.connect/);
});

// ── Ambiguidade: não adivinhar ──────────────────────────────────────────────

test("ambiguidade material para o loop antes de qualquer decisao", async () => {
  const intent = intentBase();
  intent.ambiguities = [{ field: "audience", reason_code: "AMBIGUOUS_AUDIENCE" }];
  const { loop, visto } = montar({ intent });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "CLARIFICATION_REQUIRED");
  assert.ok(r.response.reason_codes.includes("AMBIGUOUS_AUDIENCE"));
  assert.equal(visto.executadoCom.length, 0, "adivinhar aqui e decidir sobre o que ninguem afirmou");
});

test("entidade que nao resolveu para ID canonico nao vira palpite", async () => {
  const intent = intentBase();
  intent.entities = [{ type: "brand", canonical_id: null, raw: "a marca nova" }];
  const { loop, visto } = montar({ intent });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "CLARIFICATION_REQUIRED");
  assert.ok(r.response.reason_codes.includes("AMBIGUOUS_ENTITY"));
  assert.match(r.response.message, /a marca nova/);
  assert.equal(visto.executadoCom.length, 0);
});

test("intent UNKNOWN pergunta em vez de tentar", async () => {
  const intent = { ...intentBase(), intent: "UNKNOWN" };
  const { loop, visto } = montar({ intent });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "CLARIFICATION_REQUIRED");
  assert.equal(visto.executadoCom.length, 0);
});

// ── Policy antes de efeito ──────────────────────────────────────────────────

test("sem policy ACTIVE o loop nega por padrao", async () => {
  const { loop, visto } = montar({ policies: [] });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "POLICY_BLOCKED");
  assert.equal(visto.executadoCom.length, 0);
});

test("APPROVAL_REQUIRED sem approval_id para antes de compilar", async () => {
  const POL_APPROVA = {
    policy_id: "P_APROVA", version: 1, status: "ACTIVE", priority: 10,
    scope: {}, conditions: [], effect: "REQUIRE_APPROVAL", max_autonomy: "A2",
    reason_code: "COMPLIANCE_REVIEW_REQUIRED",
  };
  const { loop, visto } = montar({ policies: [POL_APPROVA] });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "APPROVAL_REQUIRED");
  assert.equal(visto.compiladoCom.length, 0, "nem compilar, quanto mais executar");
  assert.equal(visto.executadoCom.length, 0);
});

test("dry_run avalia tudo e nao executa nada", async () => {
  const { loop, visto } = montar();
  const r = await loop.run(pedido({ dry_run: true }));

  assert.equal(r.response.respondability, "EXECUTABLE");
  assert.equal(visto.executadoCom.length, 0, "dry_run que executa nao e dry_run");
});

// ── Tenant ──────────────────────────────────────────────────────────────────

test("tenant vindo do input do usuario e violacao, nao correcao", async () => {
  const { loop } = montar();
  await assert.rejects(
    () => loop.run(pedido({ input: { text: "oi", org_id: "outra" } })),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION");
});

test("workspace que nao pertence a org para o loop", async () => {
  const { loop } = montar({ workspaceOk: false });
  await assert.rejects(
    () => loop.run(pedido()),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION");
});

test("agente CANDIDATE so roda em modo interno", async () => {
  const cand = { ...AGENT, status: "CANDIDATE" };
  const { loop } = montar({ agent: cand });
  await assert.rejects(() => loop.run(pedido()), (e) => e.reason_code === "AGENT_NOT_ACTIVE");

  const { loop: loop2 } = montar({ agent: cand });
  const r = await loop2.run(pedido({ internal: true }));
  assert.equal(r.response.respondability, "EXECUTABLE");
});

test("agente CANDIDATE nao opera acima do proprio baseline", async () => {
  const cand = { ...AGENT, status: "CANDIDATE", baseline_autonomy: "A1", max_autonomy: "A3" };
  const { loop } = montar({ agent: cand });
  const r = await loop.run(pedido({ internal: true, requested_autonomy: "A3" }));
  assert.equal(r.response.autonomy_mode, "SUGGEST", "A1 nao vira A3 por pedido");
});

// ── Validator: nunca converte erro em sucesso ───────────────────────────────

test("execucao FAILED nao vira resposta bonita", async () => {
  const gateway = {
    execute: async (request) => ({
      respondability: { state: "EXECUTABLE", reason_codes: [] },
      execution: {
        trace_id: request.trace_id, capability_id: request.capability_id,
        status: "FAILED", provider: "meta_graph", external_id: null,
        error: { class: "TRANSIENT", reason_code: "PROVIDER_RATE_LIMITED", retryable: true },
        attempts: 1, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      },
    }),
  };
  const { loop } = montar({ gateway });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "TEMPORARILY_UNAVAILABLE");
  assert.ok(r.response.reason_codes.includes("PROVIDER_RATE_LIMITED"));
});

test("sucesso de provider sem external_id nao conta como efeito", async () => {
  const gateway = {
    execute: async (request) => ({
      respondability: { state: "EXECUTABLE", reason_codes: [] },
      execution: {
        trace_id: request.trace_id, capability_id: request.capability_id,
        status: "SUCCEEDED", provider: "meta_graph", external_id: null, error: null,
        attempts: 1, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      },
    }),
  };
  const { loop } = montar({ gateway });
  const r = await loop.run(pedido());
  assert.equal(r.response.respondability, "TEMPORARILY_UNAVAILABLE");
  assert.deepEqual(r.response.reason_codes, ["PROVIDER_UNAVAILABLE"],
    "provider que responde sem id nao provou efeito nenhum");
});

// ── Evidence e grounding ────────────────────────────────────────────────────

test("evidence sem origem e descartada, nao aceita", () => {
  const { pkg, descartados } = buildEvidence({
    trace_id: "t", items: [
      { evidence_id: "e1", source_kind: "BRAND_BRAIN", locator: "brand://1", hash: "h1" },
      { evidence_id: "e2", source_kind: "BRAND_BRAIN" },            // sem locator nem hash
      { evidence_id: "e3", locator: "x://y", hash: "h3" },          // sem source_kind
    ],
  });
  assert.equal(pkg.items.length, 1);
  assert.equal(descartados, 2);
});

test("responder que cita evidencia inexistente nao passa", async () => {
  const { loop } = montar({
    resposta: { message: "Feito.", next_step: "Revise.", evidence_ids: ["nao-existe"] },
  });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "QUALITY_BLOCKED");
  assert.ok(r.response.reason_codes.includes("EVIDENCE_INSUFFICIENT"));
});

test("o receipt de um efeito externo vira evidencia do proprio efeito", async () => {
  const gateway = {
    execute: async (request) => ({
      respondability: { state: "EXECUTABLE", reason_codes: [], granted_autonomy: "A3" },
      execution: {
        trace_id: request.trace_id, capability_id: request.capability_id,
        status: "SUCCEEDED", provider: "meta_graph", external_id: "ig_1", error: null,
        attempts: 1, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      },
      receipt: {
        receipt_id: "44444444-4444-4444-8444-444444444444",
        provider: "meta_graph", external_id: "ig_1", request_hash: "abc",
        recorded_at: new Date().toISOString(),
      },
    }),
  };
  const { loop } = montar({ gateway });
  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "EXECUTABLE");
  assert.equal(r.evidence.items.length, 1);
  assert.equal(r.evidence.items[0].source_kind, "PROVIDER_RESPONSE");
  assert.match(r.evidence.items[0].locator, /meta_graph:\/\/ig_1/);
  assert.deepEqual(r.response.receipt_ids, ["44444444-4444-4444-8444-444444444444"]);
});

// ── Contexto recuperado ─────────────────────────────────────────────────────

test("contexto vencido derruba a checagem de freshness", async () => {
  const { loop } = montar({
    retrieval: { fetch: async () => ({ slices: [], versions: [], stale: true }) },
  });
  const r = await loop.run(pedido());
  assert.equal(r.response.respondability, "TEMPORARILY_UNAVAILABLE");
  assert.deepEqual(r.response.reason_codes, ["SOURCE_STALE"],
    "contexto vencido nao pode sustentar efeito em silencio");
});

// ── Validator isolado ───────────────────────────────────────────────────────

test("validateResult cobre as cinco checagens do contrato", () => {
  const v = validateResult({
    trace_id: "t",
    execution: {
      trace_id: "t", capability_id: "c", status: "SUCCEEDED", provider: null,
      external_id: null, error: null, attempts: 1,
      started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
    },
    tenant: { org_id: ORG, workspace_id: WS },
  });
  assert.equal(v.valid, true);
  assert.deepEqual(v.checks.map((c) => c.check).sort(),
    ["cardinality", "failure_normalized", "freshness", "schema", "tenant_scope"]);
});
