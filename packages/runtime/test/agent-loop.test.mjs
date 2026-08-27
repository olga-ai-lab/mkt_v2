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
import { createInternalCompilers } from "../src/capability-compilers.mjs";

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
    entityResolver: over.entityResolver,
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

// ── O que segue depois da resolução de entidade ─────────────────────────────

test("retrieval e planner recebem as entidades VERIFICADAS, e nao as do modelo", async () => {
  // O caso em que os dois lados discordam: o modelo escreveu um id, e a
  // resolução contra o cadastro chegou a outro. O compilador ja recebia o
  // verificado; o retrieval nao — e e ele quem escolhe QUAL Brand Brain entra
  // no contexto. Um agente que pensa com a marca A e escreve na marca B e o
  // defeito mais caro possivel, e nenhum erro apareceria no caminho.
  const VERIFICADO = "44444444-4444-4444-8444-444444444444";
  const visto = { retrieval: null, planner: null };

  const { loop } = montar({
    entityResolver: {
      resolve: async ({ trace_id, tenant }) => ({
        ok: true,
        resolution: { trace_id, tenant, resolved: [
          { entity_type: "content_version", canonical_id: VERIFICADO,
            method: "unique_natural_key", confidence_band: "HIGH" }] },
        entities: [{ type: "content_version", canonical_id: VERIFICADO, raw: "o post de ontem" }],
        divergencias: [],
      }),
    },
    retrieval: { fetch: async ({ intent }) => {
      visto.retrieval = intent.entities;
      return { slices: [], versions: [], stale: false };
    } },
  });

  const r = await loop.run(pedido());
  assert.equal(r.response.respondability, "EXECUTABLE");
  assert.deepEqual(visto.retrieval.map((e) => e.canonical_id), [VERIFICADO],
    "o retrieval leu o id do modelo, e nao o que o cadastro confirmou");
});

test("entidade nao resolvida para o loop antes de qualquer leitura", async () => {
  let leu = false;
  const { loop } = montar({
    entityResolver: {
      resolve: async ({ trace_id, tenant }) => ({
        ok: false,
        resolution: { trace_id, tenant, resolved: [],
          unresolved: [{ entity_type: "brand", raw: "Seguros XPTO",
                         reason_code: "NORMALIZATION_FAILED" }] },
        entities: [], divergencias: [],
      }),
    },
    retrieval: { fetch: async () => { leu = true; return { slices: [] }; } },
  });

  const r = await loop.run(pedido());
  assert.equal(r.response.respondability, "CLARIFICATION_REQUIRED");
  assert.deepEqual(r.response.reason_codes, ["NORMALIZATION_FAILED"]);
  assert.equal(leu, false, "parar depois de ler seria pagar o contexto de um run que nao acontece");
});

test("tipo que o sistema nao resolve vira UNSUPPORTED, e nao pergunta", async () => {
  // Nada que a pessoa responda conserta "nao sei tratar `connection`".
  // Vestir isso de pergunta a faz reescrever o pedido para sempre.
  const { loop } = montar({
    entityResolver: {
      resolve: async ({ trace_id, tenant }) => ({
        ok: false,
        resolution: { trace_id, tenant, resolved: [],
          unresolved: [{ entity_type: "connection", reason_code: "UNSUPPORTED_VALUE" }] },
        entities: [], divergencias: [],
      }),
    },
  });

  const r = await loop.run(pedido());
  assert.equal(r.response.respondability, "UNSUPPORTED");
  assert.deepEqual(r.response.reason_codes, ["UNSUPPORTED_VALUE"]);
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
  // "nao achei" e diferente de "achei varios": a pessoa que recebe a primeira
  // confere o nome; a que recebe a segunda escolhe. Trocar manda ela fazer a
  // coisa errada.
  assert.deepEqual(r.response.reason_codes, ["NORMALIZATION_FAILED"]);
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

// ── O plano de dois passos: o que um leu, o outro usa ───────────────────────
//
// Onboarding de marca e o primeiro caso em que o passo 2 depende do que o
// passo 1 produziu. Ate aqui todo passo era compilado contra o mesmo
// `recuperado`, e brand.propose_version recusava sempre — com um reason code
// correto, o que fazia a falha parecer comportamento.

const BRAND_ID = "44444444-4444-4444-8444-444444444444";
const PAGINA_HASH = "hash-da-pagina-lida";

const AGENT_BRAND = {
  agent_id: "AGT-MKT-BRAND", version: 1, status: "ACTIVE",
  mission: "Montar e manter o Brand Brain.",
  baseline_autonomy: "A2", max_autonomy: "A2",
  capabilities: ["brand.extract_from_url", "brand.propose_version", "brand.read"],
  model_profile: { task_class: "extraction" },
};

const CAPS_BRAND = {
  "brand.extract_from_url": {
    capability_id: "brand.extract_from_url", version: 1, status: "ACTIVE", mode: "read",
    side_effect: "internal", risk_tier: "LOW", permissions: ["OWNER", "MARKETING"],
    provider_adapter: "brand_extract", idempotency: { required: false },
  },
  "brand.propose_version": {
    capability_id: "brand.propose_version", version: 1, status: "ACTIVE", mode: "write",
    side_effect: "internal", risk_tier: "MEDIUM", permissions: ["OWNER", "MARKETING"],
    idempotency: { required: false },
  },
};

const EXTRAIDO = {
  brand_id: BRAND_ID,
  identity: { summary: "Corretora de risco climatico." },
  tone: { voice: "Direta." },
  claims_allowed: ["Atende enchente desde 1998"],
  prohibitions: [],
  disclaimers: ["Consulte as condicoes gerais"],
  source_refs: [{ kind: "WEB_PAGE", locator: "https://ipe.example/", hash: PAGINA_HASH,
                  retrieved_at: "2026-08-26T12:00:00.000Z" }],
  discarded: [{ field: "claims_allowed", text: "A maior do pais", reason_code: "CLAIM_UNSUPPORTED" }],
};

function montarOnboarding(over = {}) {
  const executadoCom = [];
  const saidas = over.saidas ?? {
    "brand.extract_from_url": EXTRAIDO,
    "brand.propose_version": { brand_brain_version_id: "bbv-1", version: 1, status: "CANDIDATE" },
  };

  const loop = createAgentLoop({
    resolver: {
      resolve: async () => ({
        trace_id: "tr_onb", tenant: { org_id: ORG, workspace_id: WS },
        intent: "ONBOARD_BRAND", confidence_band: "HIGH",
        entities: [{ type: "brand", canonical_id: BRAND_ID, raw: "a Ipe" }],
        ambiguities: [],
      }),
    },
    planner: {
      plan: async () => ({
        trace_id: "tr_onb", tenant: { org_id: ORG, workspace_id: WS },
        agent_id: AGENT_BRAND.agent_id, agent_version: "1",
        steps: [
          { step_id: "s1", capability_id: "brand.extract_from_url", mode: "read",
            args_summary: "ler o site da marca" },
          { step_id: "s2", capability_id: "brand.propose_version", mode: "write",
            args_summary: "propor a versao a partir do que foi lido" },
        ],
        expected_outcome: "uma versao candidata de Brand Brain",
      }),
    },
    responder: { respond: async () => ({ message: "Montei uma proposta.", next_step: "Revise e ative." }) },
    // O retrieval de verdade devolve `brand` para intencao de onboarding; aqui
    // ele e roteirizado porque o que esta sob teste e o encadeamento.
    retrieval: { fetch: async () => ({
      slices: [], versions: [], stale: false,
      brand: { brand_id: BRAND_ID, name: "Corretora Ipe",
               website_url: over.semSite ? null : "https://ipe.example" },
    }) },
    compiler: over.compiler ?? createCompiler(createInternalCompilers({})),
    gateway: {
      execute: async (request) => {
        executadoCom.push(request);
        return {
          respondability: { state: "EXECUTABLE", reason_codes: [], granted_autonomy: "A2" },
          execution: {
            trace_id: request.trace_id, capability_id: request.capability_id,
            status: "SUCCEEDED", provider: null, external_id: null, error: null,
            attempts: 1, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
          },
          output: saidas[request.capability_id] ?? null,
        };
      },
    },
    registry: {
      getAgent: async () => AGENT_BRAND,
      getCapability: async (id) => CAPS_BRAND[id] ?? null,
      workspaceBelongsToOrg: async () => true,
    },
    policies: { listActive: async () => [POL_ALLOW] },
    runs: { start: async () => {}, finish: async () => {} },
    ids: { newId: () => "00000000-0000-4000-8000-000000000009", newTraceId: () => "tr_onb" },
  });

  return { loop, executadoCom };
}

const pedidoOnboarding = () => ({
  trace_id: "tr_onb",
  tenant: { org_id: ORG, workspace_id: WS },
  actor: { id: "u1", role: "OWNER", org_id: ORG },
  agent_id: "AGT-MKT-BRAND",
  input: { text: "monta a marca a partir do nosso site" },
  facts: {},
});

test("o que a extracao produziu vira argumento da proposta", async () => {
  const { loop, executadoCom } = montarOnboarding();
  const r = await loop.run(pedidoOnboarding());

  assert.equal(r.response.respondability, "EXECUTABLE");
  assert.equal(executadoCom.length, 2);

  // Passo 1: a URL saiu do cadastro, e nao do texto de quem pediu.
  assert.equal(executadoCom[0].args.url, "https://ipe.example");

  // Passo 2: os campos vieram do passo 1, compilados por codigo.
  const propor = executadoCom[1].args;
  assert.deepEqual(propor.claims_allowed, ["Atende enchente desde 1998"]);
  assert.deepEqual(propor.disclaimers, ["Consulte as condicoes gerais"]);
  assert.deepEqual(propor.source_refs, EXTRAIDO.source_refs);
  assert.equal(propor.brand_id, BRAND_ID);
  // Nem o status nem o relatorio de descarte viram argumento: um e da porta,
  // o outro e para quem revisa.
  assert.equal(propor.status, undefined);
  assert.equal(propor.discarded, undefined);
});

test("a pagina lida sustenta a resposta, mesmo sem receipt nenhum", async () => {
  // Capability interna nao emite receipt — so efeito externo emite. Sem a
  // evidencia vinda de source_refs, um run cujo trabalho inteiro foi ler algo
  // responderia sem se apoiar em nada.
  const { loop } = montarOnboarding();
  const r = await loop.run(pedidoOnboarding());

  assert.ok(r.response.evidence_ids.includes(PAGINA_HASH));
  const item = r.evidence.items.find((i) => i.evidence_id === PAGINA_HASH);
  assert.equal(item.source_kind, "SOURCE_ARTIFACT");
  assert.equal(item.locator, "https://ipe.example/");
});

test("sem o que a extracao produz, propor para o loop em vez de escrever pela metade", async () => {
  const { loop, executadoCom } = montarOnboarding({
    saidas: { "brand.extract_from_url": null },
  });
  const r = await loop.run(pedidoOnboarding());

  assert.equal(r.response.respondability, "QUALITY_BLOCKED");
  assert.deepEqual(r.response.reason_codes, ["EVIDENCE_INSUFFICIENT"]);
  assert.equal(executadoCom.length, 1, "o segundo passo nao pode ter sido executado");
});

// ── Recusa de compilador e resposta, nao excecao ────────────────────────────

test("marca sem site cadastrado vira pergunta, e nao erro", async () => {
  // O arquivo dos compiladores sempre prometeu esta transformacao. Ela nao
  // existia: a recusa subia como excecao e quem pediu recebia um erro no lugar
  // da frase escrita para ele ler.
  const { loop, executadoCom } = montarOnboarding({ semSite: true });
  const r = await loop.run(pedidoOnboarding());

  assert.equal(r.response.respondability, "CLARIFICATION_REQUIRED");
  assert.deepEqual(r.response.reason_codes, ["NORMALIZATION_FAILED"]);
  assert.match(r.response.message, /site cadastrado/);
  assert.equal(executadoCom.length, 0);
});

test("defeito de compilador continua subindo, em vez de virar resposta bonita", async () => {
  // Um TypeError num builder e bug nosso. Transforma-lo em CLARIFICATION_REQUIRED
  // esconderia o defeito atras de uma pergunta educada ao cliente.
  const { loop } = montarOnboarding({
    compiler: createCompiler({
      "brand.extract_from_url": () => { throw new TypeError("undefined nao e funcao"); },
      "brand.propose_version": () => ({}),
    }),
  });
  await assert.rejects(() => loop.run(pedidoOnboarding()), TypeError);
});

// ── O laudo para o loop, e quem o emitiu nao muda isso ──────────────────────

test("laudo que reprova para o loop mesmo vindo de uma capability de escrita", async () => {
  // O gatilho era `mode === "simulate"`, enquanto so simulate produzia laudo.
  // quality.ai_review e write e produz um — e um laudo que reprova nao vira
  // menos verdadeiro por quem o emitiu ter permissao de escrever.
  const executados = [];
  const CAP_REVIEW = {
    capability_id: "quality.ai_review", version: 1, status: "ACTIVE", mode: "write",
    side_effect: "internal", risk_tier: "LOW", permissions: ["OWNER", "MARKETING"],
    idempotency: { required: false },
  };

  const { loop } = montar({
    agent: { ...AGENT, capabilities: ["quality.ai_review", "approval.request"] },
    cap: CAP_REVIEW,
    plan: {
      ...planBase(),
      steps: [
        { step_id: "s1", capability_id: "quality.ai_review", mode: "write",
          args_summary: "passar o rascunho pela revisao de IA" },
        { step_id: "s2", capability_id: "approval.request", mode: "write",
          args_summary: "pedir revisao humana" },
      ],
    },
    compiler: createCompiler({
      "quality.ai_review": ({ entities }) => ({ content_version_id: entities[0]?.canonical_id }),
      "approval.request": ({ entities }) => ({ content_version_id: entities[0]?.canonical_id }),
    }),
    gateway: {
      execute: async (request) => {
        executados.push(request.capability_id);
        return {
          respondability: { state: "EXECUTABLE", reason_codes: [], granted_autonomy: "A2" },
          execution: {
            trace_id: request.trace_id, capability_id: request.capability_id,
            status: "SUCCEEDED", provider: null, external_id: null, error: null,
            attempts: 1, started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
          },
          // A capability funcionou; o laudo dela e que reprova.
          output: { trace_id: request.trace_id, valid: false,
                    checks: [{ check: "claims_supported", passed: false }],
                    reason_codes: ["CLAIM_UNSUPPORTED"] },
        };
      },
    },
  });

  const r = await loop.run(pedido());

  assert.equal(r.response.respondability, "QUALITY_BLOCKED");
  assert.deepEqual(r.response.reason_codes, ["CLAIM_UNSUPPORTED"]);
  assert.deepEqual(executados, ["quality.ai_review"],
    "pedir aprovacao depois da propria conferencia recusar seria decidir contra o que se apurou");
});
