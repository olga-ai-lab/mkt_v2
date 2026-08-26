/**
 * Adapter brand_extract.
 *
 * O arquivo trata de uma pergunta só, feita de vários ângulos: o que o modelo
 * disse sobre a marca tem lastro na página, e a procedência do que entra é
 * nossa e não dele?
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrandExtractAdapter, hostDe } from "../src/adapters/brand-extract.mjs";
import { CapabilityError } from "../src/index.mjs";

const CAP = { capability_id: "brand.extract_from_url", timeout_ms: 5000 };
const ORG = "org-1";
const BRAND = "b-1";

const pedido = (args, tenant = { org_id: ORG, workspace_id: "ws-1" }) => ({
  trace_id: "t", tenant, args,
});

/**
 * Uma home plausivel. O tamanho importa: abaixo do piso do adapter a extracao
 * e recusada antes de comecar, e um fixture curto testaria outra coisa.
 */
const PAGINA =
  "Corretora Ipe. Seguros para quem mora em area de risco climatico. " +
  "Atendemos enchente e alagamento desde 1998, em todo o estado de Santa Catarina. " +
  "Nossa equipe conhece o Vale do Itajai e sabe o que uma cheia faz com uma casa, " +
  "com um estoque e com um caminhao parado. Trabalhamos com residencial, empresarial " +
  "e frota, e acompanhamos o cliente do orcamento ate a regulacao do sinistro. " +
  "Nao vendemos apolice por telefone sem visita: entender o risco de um imovel " +
  "em area alagavel exige olhar o imovel. " +
  "Atendimento de segunda a sexta, das 8h as 18h, e plantao para sinistro em " +
  "evento climatico. " +
  "Consulte as condicoes gerais da apolice. Susep 12.345. " +
  "As coberturas e os prazos descritos aqui sao um resumo e nao substituem o contrato.";

const knowledgeFixo = (brand = { id: BRAND, name: "Corretora Ipe", website_url: "https://ipe.example" }) => ({
  async brand(org_id, brand_id) {
    if (org_id !== ORG) return null;
    return brand && String(brand.id) === String(brand_id) ? brand : null;
  },
});

const fetcherFixo = (texto = PAGINA, extra = {}) => ({
  async call() {
    return {
      texto, hash: "h-pagina", url_final: "https://ipe.example/",
      request_hash: "rh", ...extra,
    };
  },
});

const extratorFixo = (resposta) => ({ async fromPage() { return resposta; } });

const LIDO_BOM = {
  identity: { summary: "Corretora com foco em risco climatico." },
  tone: { voice: "Direta e tecnica." },
  claims_allowed: [{ text: "Atende enchente desde 1998", quote: "Atendemos enchente e alagamento desde 1998" }],
  disclaimers: [{ text: "Consulte as condicoes gerais", quote: "Consulte as condicoes gerais da apolice" }],
};

const montar = (over = {}) => createBrandExtractAdapter({
  knowledge: knowledgeFixo(), fetcher: fetcherFixo(), extract: extratorFixo(LIDO_BOM),
  clock: { now: () => Date.parse("2026-08-26T12:00:00Z") },
  ...over,
});

const erro = async (fn) => {
  try { await fn(); } catch (e) { return e; }
  throw new Error("esperava falha e nao houve");
};

// ── O caminho feliz, e o que ele prova ──────────────────────────────────────

test("extrai a marca e assina a procedencia com o que foi buscado", async () => {
  const r = await montar().call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) });

  assert.deepEqual(r.output.claims_allowed, ["Atende enchente desde 1998"]);
  assert.deepEqual(r.output.disclaimers, ["Consulte as condicoes gerais"]);
  assert.deepEqual(r.output.discarded, []);
  assert.deepEqual(r.output.source_refs, [{
    kind: "WEB_PAGE",
    locator: "https://ipe.example/",
    hash: "h-pagina",
    retrieved_at: "2026-08-26T12:00:00.000Z",
  }]);
  // O id do efeito e o hash do que foi lido: nao houve efeito externo nenhum.
  assert.equal(r.external_id, "h-pagina");
});

test("a URL final, depois do redirecionamento, e a que fica na procedencia", async () => {
  const r = await montar({
    fetcher: fetcherFixo(PAGINA, { url_final: "https://ipe.example/institucional" }),
  }).call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) });

  assert.equal(r.output.source_refs[0].locator, "https://ipe.example/institucional");
});

test("prohibitions sai sempre vazia: pagina nao diz o que a marca se recusa a dizer", async () => {
  const r = await montar().call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) });
  assert.deepEqual(r.output.prohibitions, []);
});

// ── A conferencia de citacao ────────────────────────────────────────────────

test("item cuja citacao nao esta na pagina nao entra, e aparece em discarded", async () => {
  const r = await montar({
    extract: extratorFixo({
      ...LIDO_BOM,
      claims_allowed: [
        { text: "Atende enchente desde 1998", quote: "Atendemos enchente e alagamento desde 1998" },
        { text: "A maior corretora do pais", quote: "Somos a maior corretora do pais" },
      ],
    }),
  }).call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) });

  assert.deepEqual(r.output.claims_allowed, ["Atende enchente desde 1998"]);
  assert.deepEqual(r.output.discarded, [
    { field: "claims_allowed", text: "A maior corretora do pais", reason_code: "CLAIM_UNSUPPORTED" },
  ]);
});

test("a conferencia ignora acento, caixa e espaco, e nao o conteudo", async () => {
  const r = await montar({
    fetcher: fetcherFixo("A CORRETORA IPE   atende ENCHENTE e alagamento desde 1998. " + PAGINA),
    extract: extratorFixo({
      ...LIDO_BOM,
      claims_allowed: [{ text: "Atende enchente", quote: "atende enchente e alagamento désde 1998" }],
      disclaimers: [],
    }),
  }).call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) });

  assert.deepEqual(r.output.claims_allowed, ["Atende enchente"]);
});

test("citacao curta demais nao sustenta nada", async () => {
  // Oito caracteres e o piso do contrato. Abaixo disso qualquer pagina
  // "contem" a citacao, e a conferencia viraria carimbo.
  const r = await montar({
    extract: extratorFixo({ ...LIDO_BOM, claims_allowed: [{ text: "Seguro", quote: "de" }], disclaimers: [] }),
  }).call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) });

  assert.deepEqual(r.output.claims_allowed, []);
  assert.equal(r.output.discarded[0].reason_code, "CLAIM_UNSUPPORTED");
});

// ── A URL nao e escolha de quem chama ───────────────────────────────────────

test("recusa endereco de outro dominio, mesmo com brand_id certo", async () => {
  const e = await erro(() => montar().call({
    capability: CAP,
    request: pedido({ brand_id: BRAND, url: "https://outro.example/pagina" }),
  }));
  assert.ok(e instanceof CapabilityError);
  assert.equal(e.reason_code, "UNSUPPORTED_VALUE");
});

test("aceita outra pagina do mesmo site", async () => {
  const r = await montar().call({
    capability: CAP,
    request: pedido({ brand_id: BRAND, url: "https://www.ipe.example/sobre" }),
  });
  assert.equal(r.output.brand_id, BRAND);
});

test("marca de outro tenant nao existe daqui", async () => {
  const e = await erro(() => montar().call({
    capability: CAP,
    request: pedido({ brand_id: BRAND, url: "https://ipe.example" }, { org_id: "org-2", workspace_id: "ws-9" }),
  }));
  assert.equal(e.reason_code, "NORMALIZATION_FAILED");
});

test("marca sem site cadastrado e recusa nomeada, nao busca as cegas", async () => {
  const e = await erro(() => montar({
    knowledge: knowledgeFixo({ id: BRAND, name: "Sem site", website_url: null }),
  }).call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) }));
  assert.equal(e.reason_code, "NORMALIZATION_FAILED");
});

test("hostDe iguala www e caixa, e devolve null para lixo", () => {
  assert.equal(hostDe("https://WWW.Ipe.example/x"), "ipe.example");
  assert.equal(hostDe("https://ipe.example"), "ipe.example");
  assert.equal(hostDe("nao e url"), null);
});

// ── O tamanho da pagina ─────────────────────────────────────────────────────

test("pagina curta demais nao vira marca inventada", async () => {
  const e = await erro(() => montar({ fetcher: fetcherFixo("Carregando...") })
    .call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) }));
  assert.equal(e.reason_code, "EVIDENCE_INSUFFICIENT");
});

test("pagina longa demais e recusada, nao truncada", async () => {
  const e = await erro(() => montar({ fetcher: fetcherFixo("a".repeat(40_001)) })
    .call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) }));
  assert.equal(e.reason_code, "UNSUPPORTED_VALUE");
});

test("nao gasta chamada de modelo quando a pagina ja foi recusada", async () => {
  let chamou = 0;
  await erro(() => montar({
    fetcher: fetcherFixo("curta"),
    extract: { async fromPage() { chamou++; return LIDO_BOM; } },
  }).call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) }));
  assert.equal(chamou, 0);
});

// ── Falhas das portas viram recusa nomeada ──────────────────────────────────

test("falha do extrator chega com o reason code dela, e nao retentavel", async () => {
  const e = await erro(() => montar({
    extract: {
      async fromPage() {
        const err = new Error("orcamento do workspace esgotado");
        err.reason_code = "SPEND_LIMIT_EXCEEDED";
        throw err;
      },
    },
  }).call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) }));

  assert.equal(e.reason_code, "SPEND_LIMIT_EXCEEDED");
  assert.equal(e.retryable, false);
});

test("porta faltando e PROVIDER_UNAVAILABLE, nao TypeError", async () => {
  const e = await erro(() => createBrandExtractAdapter({ fetcher: fetcherFixo(), extract: extratorFixo(LIDO_BOM) })
    .call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) }));
  assert.ok(e instanceof CapabilityError);
  assert.equal(e.reason_code, "PROVIDER_UNAVAILABLE");
});

test("knowledge sem o metodo brand falha igual a knowledge ausente", async () => {
  const e = await erro(() => montar({ knowledge: {} })
    .call({ capability: CAP, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }) }));
  assert.equal(e.reason_code, "PROVIDER_UNAVAILABLE");
});

test("capability que nao e desta casa nao e executada por engano", async () => {
  const e = await erro(() => montar().call({
    capability: { capability_id: "publishing.publish" }, request: pedido({ brand_id: BRAND, url: "https://ipe.example" }),
  }));
  assert.equal(e.reason_code, "CAPABILITY_NOT_ACTIVE");
});
