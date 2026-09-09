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

// ── Pedir acima do teto: rebaixa, ou escala para aprovacao? ─────────────────
//
// A regra pretendida sempre esteve no comentario da clausula: efeito externo
// vira aprovacao; leitura e rascunho apenas rebaixam. A implementacao usava
// `capability_mode === "write"` como proxy, e o proxy nao e a regra —
// `content.create_draft` escreve no NOSSO banco, e o que ele escreve se apaga.
//
// A diferenca era inalcancavel enquanto nenhum agente que escreve estava
// ACTIVE. Depois da migration 0013 ela passou a valer em todo rascunho, e quem
// achou foi o eval CONTENT-GOLD-001 — o caminho normal do agente de conteudo.

const rascunhoCtx = {
  capability_id: "content.create_draft", capability_mode: "write",
  side_effect: "internal", agent_id: "AGT-MKT-CONTENT", risk_tier: "LOW",
};

const allowRascunho = {
  policy_id: "POL_DRAFT", version: 1, status: "ACTIVE", priority: 600,
  scope: { capability_id: "content.create_draft" },
  conditions: [], effect: "ALLOW", max_autonomy: "A2",
};

test("rascunho pedido acima do teto rebaixa, e diz que rebaixou", () => {
  const r = evaluate({
    context: rascunhoCtx, facts: {}, requested_autonomy: "A3", policies: [allowRascunho],
  });

  assert.equal(r.state, "EXECUTABLE",
    "efeito interno acima do teto nao vira fila de aprovacao: o que ele escreve se apaga");
  assert.equal(r.granted_autonomy, "A2", "a policy so restringe, e restringiu");
  assert.ok(r.reason_codes.includes("AUTONOMY_EXCEEDED"),
    "rebaixar sem dizer seria rebaixamento silencioso, que e outra coisa");
  assert.equal(r.required_approval, false);
});

test("publicar pedido acima do teto continua virando aprovacao", () => {
  // O par do teste acima. Se os dois nao existissem juntos, trocar a regra
  // por 'nunca escala' passaria com o primeiro sozinho.
  const r = evaluate({
    context: { ...publishCtx, side_effect: "external" },
    facts: happyFacts, requested_autonomy: "A4",
    policies: [{ ...allowPublish, max_autonomy: "A2" }],
  });

  assert.equal(r.state, "APPROVAL_REQUIRED",
    "efeito externo acima do teto nao rebaixa em silencio: post no perfil do cliente nao desfaz");
  assert.ok(r.reason_codes.includes("AUTONOMY_EXCEEDED"));
  assert.equal(r.required_approval, true);
});

test("sem side_effect no contexto, mantem o comportamento antigo e mais restritivo", () => {
  // Um chamador que nao informa o efeito nao deve ganhar permissividade por
  // omissao. Escrita sem efeito declarado continua escalando.
  const { side_effect, ...semEfeito } = rascunhoCtx;
  const r = evaluate({
    context: semEfeito, facts: {}, requested_autonomy: "A3", policies: [allowRascunho],
  });
  assert.equal(r.state, "APPROVAL_REQUIRED");
});

test("leitura acima do teto rebaixa, com ou sem side_effect declarado", () => {
  for (const ctx of [
    { capability_id: "brand.read", capability_mode: "read", risk_tier: "LOW" },
    { capability_id: "brand.read", capability_mode: "read", side_effect: "none", risk_tier: "LOW" },
  ]) {
    const r = evaluate({
      context: ctx, facts: {}, requested_autonomy: "A4",
      policies: [{ policy_id: "P", version: 1, status: "ACTIVE", priority: 600,
                   scope: { capability_id: "brand.read" }, conditions: [],
                   effect: "ALLOW", max_autonomy: "A2" }],
    });
    assert.equal(r.state, "EXECUTABLE");
    assert.equal(r.granted_autonomy, "A2");
  }
});

// ── A ordem dos reason codes tem significado ───────────────────────────────
//
// Quem consome le `reason_codes[0]`: o gateway monta o ExecutionResult BLOCKED
// exatamente assim. Se um invariante que so baixou o teto vier antes do codigo
// que decidiu, quem opera procura no lugar errado.
//
// Achado ao ligar o agendador recorrente (C3): um slot bloqueado por canal
// desconectado gravava WORKSPACE_FIRST_PUBLISH na propria linha.

test("num bloqueio, o codigo que decidiu vem antes dos invariantes", () => {
  const r = evaluate({
    context: publishCtx,
    // `workspace_first_publish` dispara um invariante que baixa o teto, e a
    // conexao caida dispara o BLOCK. Os dois codigos saem; a ordem diz qual
    // deles e a causa.
    facts: { ...happyFacts, channel_connected: false, workspace_first_publish: true },
    requested_autonomy: "A3",
    policies: [allowPublish, {
      policy_id: "POL_BLOCK_SEM_CANAL", version: 1, status: "ACTIVE", priority: 10,
      scope: {}, conditions: [{ fact: "channel_connected", op: "is_false", value: true }],
      effect: "BLOCK", reason_code: "CHANNEL_NOT_CONNECTED",
    }],
  });

  assert.equal(r.state, "POLICY_BLOCKED");
  assert.equal(r.reason_codes[0], "CHANNEL_NOT_CONNECTED",
    "o primeiro codigo tem de ser a causa do bloqueio, nao um teto que baixou junto");
  assert.ok(r.reason_codes.includes("WORKSPACE_FIRST_PUBLISH"),
    "os invariantes continuam sendo relatados; eles so nao vem na frente");
});

test("numa exigencia de aprovacao, o codigo da policy tambem vem primeiro", () => {
  const r = evaluate({
    context: publishCtx,
    facts: { ...happyFacts, claim_types: ["COVERAGE"], workspace_first_publish: true },
    requested_autonomy: "A3",
    policies: [{
      policy_id: "POL_COMPLIANCE", version: 1, status: "ACTIVE", priority: 30,
      scope: {}, conditions: [{ fact: "claim_types", op: "contains_any", value: ["COVERAGE"] }],
      effect: "REQUIRE_APPROVAL", max_autonomy: "A2", reason_code: "COMPLIANCE_REVIEW_REQUIRED",
    }],
  });

  assert.equal(r.state, "APPROVAL_REQUIRED");
  assert.equal(r.reason_codes[0], "COMPLIANCE_REVIEW_REQUIRED");
});

test("sem policy ACTIVE, NO_ACTIVE_POLICY vem primeiro", () => {
  const r = evaluate({
    context: publishCtx,
    facts: { ...happyFacts, workspace_first_publish: true },
    requested_autonomy: "A3", policies: [],
  });
  assert.equal(r.state, "POLICY_BLOCKED");
  assert.equal(r.reason_codes[0], "NO_ACTIVE_POLICY");
});

test("AUTONOMY_EXCEEDED e a excecao: quem explica e o invariante, nao o mecanismo", () => {
  // A excecao que ensina a regra. "Pediu acima do teto" nao diz a ninguem o
  // que fazer; "o conteudo nao esta aprovado" diz. Entao o invariante que
  // baixou o teto vem primeiro, e o mecanismo depois.
  //
  // Este par de testes existe junto de proposito: com o de cima sozinho,
  // trocar a ordem em toda a funcao passaria.
  const r = evaluate({
    context: { ...publishCtx, side_effect: "external" },
    facts: { ...happyFacts, content_status: "DRAFT" },
    requested_autonomy: "A3",
    policies: [allowPublish],
  });

  assert.equal(r.state, "APPROVAL_REQUIRED");
  assert.equal(r.reason_codes[0], "CONTENT_NOT_APPROVED",
    "quem le o primeiro codigo precisa saber o que fazer a respeito");
  assert.equal(r.reason_codes.at(-1), "AUTONOMY_EXCEEDED",
    "o mecanismo fica, mas nao na frente");
});
