/**
 * Adapter interno.
 *
 * Aqui se testa a LOGICA: o que conta como claim sem lastro, o que dispara
 * revisao de compliance, o que e recusado antes de virar linha no banco. As
 * portas sao dubles, porque a pergunta destes testes nao e se o SQL funciona
 * — isso e o teste de banco — e sim se a decisao esta certa.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInternalAdapter, conferirPortasInternas, SUPERFICIE_INTERNA,
         normalizarTexto } from "../src/adapters/internal.mjs";
import { CapabilityError } from "../src/index.mjs";

const TENANT = { org_id: "org-1", workspace_id: "ws-1", actor_id: "u1" };
const pedido = (args, extra = {}) => ({ trace_id: "t1", tenant: TENANT, args, ...extra });
const cap = (capability_id) => ({ capability_id });

/** Portas com o minimo, sobrescrevivel por teste. */
function portas(over = {}) {
  return {
    knowledge: {
      async brandBrain() { return { id: "bb1", brand_id: "b1", brand_name: "Marca", version: 3,
                                    identity: {}, tone: {}, claims_allowed: [],
                                    prohibitions: [], disclaimers: [] }; },
      async brandBrainForContent() { return this.brandBrain(); },
      async contentVersion() { return { id: "cv1", master_body: "Texto qualquer.", state: "DRAFT" }; },
      async claimsFor() { return []; },
      async evidenceFor() { return []; },
      async duplicateOf() { return null; },
      ...(over.knowledge ?? {}),
    },
    authoring: {
      async createDraft() { return { content_id: "c1", content_version_id: "cv1", version: 1 }; },
      async createVariant() { return { id: "v1", channel: "INSTAGRAM" }; },
      async proposeBrandVersion() { return { id: "bb2", version: 4, status: "CANDIDATE" }; },
      ...(over.authoring ?? {}),
    },
    publishing: {
      async requestApproval() { return { approval_id: "ap1", state: "HUMAN_REVIEW" }; },
      async schedule() { return { publication_id: "p1", outbox_id: "9" }; },
      ...(over.publishing ?? {}),
    },
    compose: over.compose ?? {
      async draft() { return { title: "T", master_body: "Corpo.", claims: [] }; },
      async variant() { return { headline: "H", body: "B", cta: "C" }; },
      async brandBrain() {
        return { identity: { nome: "M", o_que_faz: "x" }, tone: { descricao: "d" },
                 claims_allowed: [], prohibitions: [], disclaimers: [] };
      },
    },
  };
}

const montar = (over) => createInternalAdapter(portas(over));

// ── O mapa de capabilities ──────────────────────────────────────────────────

test("cobre as nove capabilities que o registry manda para internal", () => {
  // Esta lista e a do capability_registry com provider_adapter nulo. Se uma
  // capability nova entrar la sem entrar aqui, o gateway responderia
  // "capability interna sem executor" em producao — este teste antecipa isso.
  const esperadas = [
    "brand.read", "brand.propose_version", "evidence.read",
    "content.create_draft", "content.create_variant",
    "quality.precheck", "compliance.review",
    "approval.request", "publishing.schedule",
  ].sort();
  assert.deepEqual([...montar().capabilities].sort(), esperadas);
});

test("capability interna sem executor falha nomeada, nao com TypeError", async () => {
  await assert.rejects(
    () => montar().call({ capability: cap("nao.existe"), request: pedido({}) }),
    (e) => e instanceof CapabilityError && e.reason_code === "CAPABILITY_NOT_ACTIVE");
});

// ── Leitura ─────────────────────────────────────────────────────────────────

test("brand.read devolve o Brand Brain ativo", async () => {
  const r = await montar().call({ capability: cap("brand.read"), request: pedido({ brand_id: "b1" }) });
  assert.equal(r.external_id, "bb1");
  assert.equal(r.output.version, 3);
});

test("brand.read recusa marca sem Brand Brain ativo", async () => {
  const a = montar({ knowledge: { async brandBrain() { return null; } } });
  await assert.rejects(
    () => a.call({ capability: cap("brand.read"), request: pedido({ brand_id: "b1" }) }),
    (e) => e.reason_code === "BRAND_BRAIN_NOT_ACTIVE");
});

// ── quality.precheck: contagem, nao julgamento ──────────────────────────────

test("precheck passa quando nao ha claim material", async () => {
  const a = montar({ knowledge: {
    async claimsFor() { return [{ id: "c", text: "x", material: false, claim_type: "GENERAL", evidencias: 0 }]; },
  }});
  const r = await a.call({ capability: cap("quality.precheck"), request: pedido({ content_version_id: "cv1" }) });
  assert.equal(r.output.valid, true);
  assert.deepEqual(r.output.reason_codes, []);
});

test("precheck acusa claim material sem evidence", async () => {
  const a = montar({ knowledge: {
    async claimsFor() { return [{ id: "c", text: "cobre tudo", material: true, claim_type: "COVERAGE", evidencias: 0 }]; },
  }});
  const r = await a.call({ capability: cap("quality.precheck"), request: pedido({ content_version_id: "cv1" }) });
  assert.equal(r.output.valid, false);
  assert.deepEqual(r.output.reason_codes.sort(), ["CLAIM_UNSUPPORTED", "EVIDENCE_INSUFFICIENT"]);
  assert.equal(r.output.checks.find((c) => c.check === "claims_supported").passed, false);
});

test("precheck com claim material E evidence nao acusa insuficiencia", async () => {
  const a = montar({ knowledge: {
    async claimsFor() { return [{ id: "c", text: "x", material: true, claim_type: "PRICE", evidencias: 2 }]; },
    async evidenceFor() { return [{ id: "e1", source_kind: "SOURCE_ARTIFACT", locator: "l", hash: "h", retrieved_at: new Date() }]; },
  }});
  const r = await a.call({ capability: cap("quality.precheck"), request: pedido({ content_version_id: "cv1" }) });
  assert.equal(r.output.valid, true);
});

test("precheck acusa texto identico a outra versao", async () => {
  const a = montar({ knowledge: { async duplicateOf() { return { content_version_id: "cv9", state: "PUBLISHED" }; } } });
  const r = await a.call({ capability: cap("quality.precheck"), request: pedido({ content_version_id: "cv1" }) });
  assert.deepEqual(r.output.reason_codes, ["CONTENT_DUPLICATE_RISK"]);
});

// ── compliance.review: verifica e relata; quem bloqueia e a policy ──────────

test("compliance acusa termo proibido do Brand Brain", async () => {
  const a = montar({ knowledge: {
    async contentVersion() { return { id: "cv1", master_body: "Cobertura GARANTIDA para todos." }; },
    async brandBrainForContent() { return { id: "bb", prohibitions: ["garantida"], disclaimers: [] }; },
  }});
  const r = await a.call({ capability: cap("compliance.review"), request: pedido({ content_version_id: "cv1" }) });
  assert.equal(r.output.valid, false);
  assert.ok(r.output.reason_codes.includes("COMPLIANCE_REVIEW_REQUIRED"));
  assert.match(r.output.checks.find((c) => c.check === "prohibitions").detail, /garantida/);
});

test("compliance acha o termo proibido apesar de acento e caixa", async () => {
  const a = montar({ knowledge: {
    async contentVersion() { return { id: "cv1", master_body: "Preço IMBATÍVEL no mercado." }; },
    async brandBrainForContent() { return { id: "bb", prohibitions: ["imbatível"], disclaimers: [] }; },
  }});
  const r = await a.call({ capability: cap("compliance.review"), request: pedido({ content_version_id: "cv1" }) });
  assert.equal(r.output.checks.find((c) => c.check === "prohibitions").passed, false);
});

test("compliance marca claim de cobertura como material", async () => {
  const a = montar({ knowledge: {
    async claimsFor() { return [{ id: "c", text: "cobre enchente", material: true, claim_type: "COVERAGE", evidencias: 1 }]; },
  }});
  const r = await a.call({ capability: cap("compliance.review"), request: pedido({ content_version_id: "cv1" }) });
  assert.equal(r.output.checks.find((c) => c.check === "material_claims").passed, false);
  assert.deepEqual(r.output.reason_codes, ["COMPLIANCE_REVIEW_REQUIRED"]);
});

test("compliance aprova texto sem proibicao e sem claim material", async () => {
  const r = await montar().call({ capability: cap("compliance.review"), request: pedido({ content_version_id: "cv1" }) });
  assert.equal(r.output.valid, true);
  assert.deepEqual(r.output.reason_codes, []);
});

test("compliance exige disclaimer quando ha claim material", async () => {
  const a = montar({ knowledge: {
    async contentVersion() { return { id: "cv1", master_body: "Nosso preco cabe no bolso." }; },
    async claimsFor() { return [{ id: "c", text: "preco", material: true, claim_type: "PRICE", evidencias: 1 }]; },
    async brandBrainForContent() { return { id: "bb", prohibitions: [],
                                            disclaimers: ["Sujeito a analise de risco."] }; },
  }});
  const r = await a.call({ capability: cap("compliance.review"), request: pedido({ content_version_id: "cv1" }) });
  assert.equal(r.output.checks.find((c) => c.check === "disclaimers").passed, false);
});

// ── Escrita ─────────────────────────────────────────────────────────────────

test("create_draft recusa claim material sem evidence ANTES de gravar", async () => {
  let gravou = false;
  const a = montar({
    authoring: { async createDraft() { gravou = true; return {}; } },
    compose: { async draft() {
      return { title: "T", master_body: "Cobrimos tudo.",
               claims: [{ text: "Cobrimos tudo.", claim_type: "COVERAGE", material: true }] };
    }},
  });
  await assert.rejects(
    () => a.call({ capability: cap("content.create_draft"), request: pedido({ brand_id: "b1" }) }),
    (e) => e.reason_code === "CLAIM_UNSUPPORTED");
  assert.equal(gravou, false, "nao pode ter chegado no banco");
});

test("create_draft nao escreve para marca sem Brand Brain ativo", async () => {
  const a = montar({ knowledge: { async brandBrain() { return null; } } });
  await assert.rejects(
    () => a.call({ capability: cap("content.create_draft"), request: pedido({ brand_id: "b1" }) }),
    (e) => e.reason_code === "BRAND_BRAIN_NOT_ACTIVE");
});

test("create_draft grava a versao do Brand Brain que usou", async () => {
  let recebido = null;
  const a = montar({ authoring: { async createDraft(x) { recebido = x; return { content_version_id: "cv7" }; } } });
  const r = await a.call({ capability: cap("content.create_draft"),
                           request: pedido({ brand_id: "b1", agent_id: "AGT-MKT-CONTENT", agent_version: 1 }) });
  assert.equal(recebido.brand_brain_version_id, "bb1");
  assert.equal(recebido.agent_id, "AGT-MKT-CONTENT");
  assert.equal(recebido.actor_id, "u1");
  assert.equal(r.external_id, "cv7");
});

test("sem redator, as tres capabilities que produzem texto recusam nomeadas", async () => {
  const a = createInternalAdapter({ ...portas(), compose: null });
  const args = { brand_id: "b1", content_version_id: "cv1", channel: "BLOG",
                 source_text: "x", source_url: "https://a.test", source_hash: "h" };
  for (const c of ["content.create_draft", "content.create_variant", "brand.propose_version"]) {
    await assert.rejects(
      () => a.call({ capability: cap(c), request: pedido(args) }),
      (e) => e.reason_code === "PROVIDER_UNAVAILABLE", c);
  }
});

test("as outras seis continuam funcionando sem redator", async () => {
  const a = createInternalAdapter({ ...portas(), compose: null });
  const r = await a.call({ capability: cap("brand.read"), request: pedido({ brand_id: "b1" }) });
  assert.equal(r.external_id, "bb1");
});

// ── brand.propose_version: a cadeia que sai do site do cliente ─────────────

const PAGINA = {
  brand_id: "b1", workspace_id: "ws-1",
  source_url: "https://corretora.test/sobre",
  source_text: "Somos a Corretora. Cuidamos do seu seguro residencial.",
  source_hash: "h0",
};

test("propose_version nao tem como escrever ACTIVE: o status vem da porta", async () => {
  let recebido = null;
  const a = montar({ authoring: {
    async proposeBrandVersion(x) { recebido = x; return { id: "bb2", version: 4, status: "CANDIDATE" }; },
  }});
  const r = await a.call({ capability: cap("brand.propose_version"),
                           request: pedido({ ...PAGINA, status: "ACTIVE" }) });
  assert.equal(r.output.status, "CANDIDATE");
  assert.equal(recebido.status, undefined, "status nao pode ser repassado como argumento");
});

test("propose_version recusa quando nenhuma pagina foi lida", async () => {
  // Propor um Brand Brain sem ter lido nada seria escrever sobre a marca do
  // cliente por conta propria.
  let gravou = false;
  const a = montar({ authoring: { async proposeBrandVersion() { gravou = true; return {}; } } });
  await assert.rejects(
    () => a.call({ capability: cap("brand.propose_version"), request: pedido({ brand_id: "b1" }) }),
    (e) => e.reason_code === "EVIDENCE_INSUFFICIENT");
  assert.equal(gravou, false);
});

test("propose_version leva a fonte para virar evidence, e devolve as lacunas", async () => {
  let recebido = null;
  const a = montar({
    authoring: { async proposeBrandVersion(x) {
      recebido = x;
      return { id: "bb2", version: 2, status: "CANDIDATE",
               source_refs: [{ evidence_id: "e1", url: x.fonte.url, hash: x.fonte.hash }] };
    }},
    compose: {
      async draft() { return { title: "T", master_body: "B", claims: [] }; },
      async variant() { return { body: "B" }; },
      async brandBrain({ source_text }) {
        assert.match(source_text, /Corretora/, "o texto da pagina precisa chegar ao extrator");
        return {
          identity: { nome: "Corretora", o_que_faz: "seguros" },
          tone: { descricao: "direto" },
          claims_allowed: [], prohibitions: ["garantido"], disclaimers: [],
          nao_encontrado: ["disclaimer de cobertura"],
        };
      },
    },
  });
  const r = await a.call({ capability: cap("brand.propose_version"), request: pedido(PAGINA) });

  assert.deepEqual(recebido.fonte, { url: PAGINA.source_url, hash: "h0" });
  assert.deepEqual(recebido.prohibitions, ["garantido"]);
  assert.deepEqual(r.output.nao_encontrado, ["disclaimer de cobertura"]);
  assert.equal(r.output.source_refs[0].evidence_id, "e1");
});

test("schedule leva o approval_id do pedido, nao dos args", async () => {
  let recebido = null;
  const a = montar({ publishing: { async schedule(x) { recebido = x; return { publication_id: "p9", outbox_id: "1" }; } } });
  await a.call({
    capability: cap("publishing.schedule"),
    request: pedido({ content_version_id: "cv1", channel: "INSTAGRAM", connection_id: "k1", channel_variant_id: "v1" },
                    { approval_id: "ap-real", requested_autonomy: "A3" }),
  });
  assert.equal(recebido.approval_id, "ap-real");
  assert.equal(recebido.autonomy_used, "A3");
});

// ── Classificacao de falha ──────────────────────────────────────────────────

test("deadlock do Postgres e retentavel; queda de conexao nao", async () => {
  const comErro = (code) => montar({ knowledge: {
    async brandBrain() { throw Object.assign(new Error("boom"), { code }); },
  }});

  await assert.rejects(
    () => comErro("40P01").call({ capability: cap("brand.read"), request: pedido({ brand_id: "b" }) }),
    (e) => e.retryable === true && e.error_class === "TRANSIENT");

  // 08006 e perda de conexao: o commit pode ter acontecido do outro lado.
  // Capability interna nao tem idempotencia para deduplicar, entao repetir
  // criaria um segundo rascunho.
  await assert.rejects(
    () => comErro("08006").call({ capability: cap("brand.read"), request: pedido({ brand_id: "b" }) }),
    (e) => e.retryable !== true);
});

test("normalizarTexto colapsa espaco, tira acento e baixa a caixa", () => {
  assert.equal(normalizarTexto("  Não   É   ISSO  "), "nao e isso");
});

// ── Conferencia de superficie no boot ───────────────────────────────────────

test("porta incompleta derruba o boot com o nome do que falta", () => {
  const p = portas();
  delete p.knowledge.duplicateOf;
  assert.throws(() => conferirPortasInternas(p), /knowledge\.duplicateOf/);
});

test("as portas completas passam, e `compose` nao entra na conferencia", () => {
  const p = portas();
  assert.equal(conferirPortasInternas({ ...p, compose: null }), true);
});

test("a superficie exigida cobre todo metodo que os handlers chamam", () => {
  // Um metodo novo usado num handler sem entrar em SUPERFICIE_INTERNA volta a
  // ser um erro que so aparece no primeiro pedido real de um cliente. Os
  // handlers chamam as portas sempre por `k.`, `a.` ou `p.` — os nomes que
  // exigirPorta() devolve — entao da para ler isso da propria fonte.
  const fonte = readFileSync(new URL("../src/adapters/internal.mjs", import.meta.url), "utf8");
  const usados = [...new Set([...fonte.matchAll(/\b[kap]\.(\w+)\(/g)].map((m) => m[1]))];
  const declarados = new Set(Object.values(SUPERFICIE_INTERNA).flat());

  assert.ok(usados.length >= 8, `esperava achar as chamadas as portas, achei ${usados.length}`);
  for (const m of usados) {
    assert.ok(declarados.has(m), `${m}() e chamado mas nao esta em SUPERFICIE_INTERNA`);
  }
});

test("schedule grava a autonomia CONCEDIDA, nao a pedida", async () => {
  // Uma policy que rebaixa A3 para A2 sumiria do rastro se o adapter gravasse
  // o que foi pedido — justamente no caso em que ela agiu.
  let recebido = null;
  const a = montar({ publishing: {
    async schedule(x) { recebido = x; return { publication_id: "p", outbox_id: "1" }; },
  }});
  await a.call({
    capability: cap("publishing.schedule"),
    request: pedido({ content_version_id: "cv1", channel: "BLOG",
                      connection_id: "k", channel_variant_id: "v" }, { requested_autonomy: "A3" }),
    granted_autonomy: "A2",
  });
  assert.equal(recebido.autonomy_used, "A2");
});
