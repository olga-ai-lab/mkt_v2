/**
 * Adapter web_fetch.
 *
 * Quase todo teste aqui é uma tentativa de fazer o servidor buscar algo que
 * quem pediu não alcança sozinho. É disso que o arquivo trata.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createWebFetchAdapter, ehPublico, validarAlvo, extrairTexto } from "../src/adapters/web-fetch.mjs";

const CAP = { capability_id: "brand.extract_from_url", timeout_ms: 5000 };
const pedido = (url) => ({ trace_id: "t", tenant: {}, args: { url } });

/** Resolver falso: nome -> IPs. */
const resolverFixo = (mapa) => async (host) => {
  const ips = mapa[host];
  if (!ips) { const e = new Error("ENOTFOUND"); throw e; }
  return ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

const resposta = (body, { status = 200, type = "text/html", headers = {} } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => ({ "content-type": type, ...headers })[k.toLowerCase()] ?? null },
  arrayBuffer: async () => new TextEncoder().encode(body).buffer,
});

// ── A classificacao de endereco ─────────────────────────────────────────────

test("enderecos publicos passam", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "200.160.2.3", "2800:3f0:4000::1"]) {
    assert.equal(ehPublico(ip), true, ip);
  }
});

test("loopback, privado e link-local nao passam", () => {
  const proibidos = [
    "127.0.0.1", "127.1.2.3",          // loopback
    "10.0.0.1", "10.255.255.255",      // privado
    "172.16.0.1", "172.31.255.1",      // privado
    "192.168.0.1",                     // privado
    "169.254.169.254",                 // metadados de nuvem — o alvo classico
    "0.0.0.0", "100.64.0.1",
    "::1", "fc00::1", "fe80::1", "ff02::1",
  ];
  for (const ip of proibidos) assert.equal(ehPublico(ip), false, ip);
});

test("IPv4 mapeado em IPv6 nao burla o filtro", () => {
  // ::ffff:127.0.0.1 e loopback escrito de outro jeito. Um filtro que so
  // olhasse o formato IPv6 deixaria passar.
  assert.equal(ehPublico("::ffff:127.0.0.1"), false);
  assert.equal(ehPublico("::ffff:169.254.169.254"), false);
  assert.equal(ehPublico("::ffff:8.8.8.8"), true);
});

test("172.15 e 172.32 sao publicos — a faixa privada e so 16 a 31", () => {
  assert.equal(ehPublico("172.15.0.1"), true);
  assert.equal(ehPublico("172.32.0.1"), true);
  assert.equal(ehPublico("172.20.0.1"), false);
});

test("o que nao e IP nao vira permitido", () => {
  for (const x of ["", "abc", "999.1.1.1", "1.2.3", null, undefined]) {
    assert.equal(ehPublico(x), false, String(x));
  }
});

// ── Validacao do alvo ───────────────────────────────────────────────────────

test("http simples e recusado", async () => {
  await assert.rejects(
    () => validarAlvo("http://exemplo.com", { resolver: resolverFixo({ "exemplo.com": ["8.8.8.8"] }) }),
    /https/);
});

test("endereco com credencial embutida e recusado", async () => {
  await assert.rejects(
    () => validarAlvo("https://user:senha@exemplo.com", {
      resolver: resolverFixo({ "exemplo.com": ["8.8.8.8"] }) }),
    /credencial/);
});

test("nome que resolve para metadados de nuvem e recusado", async () => {
  await assert.rejects(
    () => validarAlvo("https://parece-inocente.com", {
      resolver: resolverFixo({ "parece-inocente.com": ["169.254.169.254"] }) }),
    /rede interna/);
});

test("nome que resolve para um publico E um interno e recusado", async () => {
  // Um nome com dois registros continua sendo caminho para o interno.
  await assert.rejects(
    () => validarAlvo("https://misto.com", {
      resolver: resolverFixo({ "misto.com": ["8.8.8.8", "10.0.0.5"] }) }),
    /rede interna/);
});

test("nome publico passa e devolve os IPs", async () => {
  const r = await validarAlvo("https://corretora.com.br/sobre", {
    resolver: resolverFixo({ "corretora.com.br": ["200.160.2.3"] }) });
  assert.equal(r.url.hostname, "corretora.com.br");
  assert.deepEqual(r.ips, ["200.160.2.3"]);
});

// ── Redirect ────────────────────────────────────────────────────────────────

test("redirect para a rede interna e barrado no salto", async () => {
  // O caso que faz o redirect ser perigoso: o primeiro endereco valida, e o
  // Location aponta para dentro. Seguir sem revalidar entregaria tudo.
  const adapter = createWebFetchAdapter({
    resolver: resolverFixo({ "publico.com": ["8.8.8.8"], "interno.com": ["10.0.0.9"] }),
    fetch: async (url) => url.includes("publico.com")
      ? resposta("", { status: 302, headers: { location: "https://interno.com/segredo" } })
      : resposta("<p>segredo</p>"),
  });

  await assert.rejects(
    () => adapter.call({ capability: CAP, request: pedido("https://publico.com") }),
    (e) => /rede interna/.test(e.message) && e.retryable === false);
});

test("redirect para outro endereco publico e seguido", async () => {
  const adapter = createWebFetchAdapter({
    resolver: resolverFixo({ "a.com": ["8.8.8.8"], "b.com": ["1.1.1.1"] }),
    fetch: async (url) => url.includes("a.com")
      ? resposta("", { status: 301, headers: { location: "https://b.com/home" } })
      : resposta("<h1>Corretora B</h1>"),
  });
  const r = await adapter.call({ capability: CAP, request: pedido("https://a.com") });
  assert.equal(r.url_final, "https://b.com/home");
  assert.match(r.texto, /Corretora B/);
});

test("cadeia longa de redirect para", async () => {
  const adapter = createWebFetchAdapter({
    resolver: resolverFixo({ "loop.com": ["8.8.8.8"] }),
    fetch: async () => resposta("", { status: 302, headers: { location: "https://loop.com/x" } }),
  });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: pedido("https://loop.com") }),
    /demais/);
});

// ── Tamanho e tipo ──────────────────────────────────────────────────────────

test("pagina grande demais e recusada, nao truncada", async () => {
  // Truncar seria pior: meia pagina vira meia verdade sobre a marca.
  const adapter = createWebFetchAdapter({
    resolver: resolverFixo({ "grande.com": ["8.8.8.8"] }),
    maxBytes: 100,
    fetch: async () => resposta("x".repeat(500)),
  });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: pedido("https://grande.com") }),
    /grande demais/);
});

test("content-length mentindo nao passa: o corte real e na leitura", async () => {
  const adapter = createWebFetchAdapter({
    resolver: resolverFixo({ "mente.com": ["8.8.8.8"] }),
    maxBytes: 100,
    fetch: async () => resposta("x".repeat(500), { headers: { "content-length": "10" } }),
  });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: pedido("https://mente.com") }),
    /grande demais/);
});

test("PDF e imagem sao recusados", async () => {
  const adapter = createWebFetchAdapter({
    resolver: resolverFixo({ "arq.com": ["8.8.8.8"] }),
    fetch: async () => resposta("%PDF-1.4", { type: "application/pdf" }),
  });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: pedido("https://arq.com/a.pdf") }),
    /página de texto/);
});

// ── Classificacao de falha ──────────────────────────────────────────────────

test("429 e 5xx sao transitorios; 404 nao", async () => {
  const mk = (status) => createWebFetchAdapter({
    resolver: resolverFixo({ "s.com": ["8.8.8.8"] }),
    fetch: async () => resposta("", { status }),
  });
  await assert.rejects(() => mk(429).call({ capability: CAP, request: pedido("https://s.com") }),
    (e) => e.retryable === true && e.reason_code === "PROVIDER_RATE_LIMITED");
  await assert.rejects(() => mk(503).call({ capability: CAP, request: pedido("https://s.com") }),
    (e) => e.retryable === true);
  await assert.rejects(() => mk(404).call({ capability: CAP, request: pedido("https://s.com") }),
    (e) => e.retryable === false);
});

// ── Extracao ────────────────────────────────────────────────────────────────

test("script e style saem do texto", async () => {
  const html = `<html><head><style>.a{color:red}</style>
    <script>alert('roubo de sessao')</script></head>
    <body><h1>Corretora A</h1><p>Seguro &amp; proteção</p></body></html>`;
  const t = extrairTexto(html);
  assert.match(t, /Corretora A/);
  assert.match(t, /Seguro & proteção/);
  assert.ok(!t.includes("alert"), "script no contexto do modelo e texto que finge ser codigo");
  assert.ok(!t.includes("color:red"));
});

test("o retorno carrega hash do texto e a url final", async () => {
  const adapter = createWebFetchAdapter({
    resolver: resolverFixo({ "c.com": ["8.8.8.8"] }),
    fetch: async () => resposta("<h1>Olá</h1>"),
  });
  const r = await adapter.call({ capability: CAP, request: pedido("https://c.com/sobre") });
  assert.equal(r.texto, "Olá");
  assert.equal(r.hash.length, 64, "sem hash o texto nao tem procedencia");
  assert.equal(r.url_final, "https://c.com/sobre");
});

test("sem url, recusa antes de qualquer rede", async () => {
  let buscou = false;
  const adapter = createWebFetchAdapter({
    resolver: resolverFixo({}), fetch: async () => { buscou = true; return resposta(""); },
  });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: { trace_id: "t", args: {} } }),
    /sem url/);
  assert.equal(buscou, false);
});
