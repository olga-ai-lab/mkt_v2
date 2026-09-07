/**
 * O consentimento da Meta, na parte que da para provar sem rede.
 *
 * O que este arquivo NAO prova, e nao finge provar: que a Meta aceita a URL,
 * que o app review saiu, que o token publica. Isso depende de uma conta real e
 * do app review (ADR-0008), e continua sendo o que falta para fechar o G1.
 *
 * O que ele prova e o que uma sessao futura vai quebrar sem perceber: a
 * assinatura do `state`, que e a unica defesa entre um redirect vindo de fora
 * e a escolha de em qual workspace a conexao e gravada.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { assinarEstado, conferirEstado, urlDeAutorizacao, createMetaOAuth,
         ESCOPOS, OAuthError } from "../src/meta-oauth.mjs";

const SEGREDO = "app-secret-de-teste";
const TENANT = { org_id: "org-1", workspace_id: "ws-1", user_id: "u-1" };

test("o estado assinado volta com o mesmo tenant", () => {
  const s = assinarEstado({ ...TENANT, app_secret: SEGREDO });
  assert.deepEqual(conferirEstado(s, { app_secret: SEGREDO }), TENANT);
});

test("estado adulterado e recusado como violacao de tenant", () => {
  // O ataque concreto: trocar o workspace_id no corpo do state para que a
  // conexao do consentimento de outra pessoa caia no seu workspace.
  const s = assinarEstado({ ...TENANT, app_secret: SEGREDO });
  const [dados, mac] = s.split(".");
  const corpo = JSON.parse(Buffer.from(dados, "base64url").toString("utf8"));
  corpo.workspace_id = "ws-do-atacante";
  const forjado = `${Buffer.from(JSON.stringify(corpo)).toString("base64url")}.${mac}`;

  assert.throws(() => conferirEstado(forjado, { app_secret: SEGREDO }),
    (e) => e instanceof OAuthError && e.reason_code === "TENANT_SCOPE_VIOLATION");
});

test("estado assinado com outro segredo nao vale", () => {
  const s = assinarEstado({ ...TENANT, app_secret: "outro-app" });
  assert.throws(() => conferirEstado(s, { app_secret: SEGREDO }),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION");
});

test("estado sem prazo seria um convite permanente; ele expira", () => {
  const s = assinarEstado({ ...TENANT, app_secret: SEGREDO, agora: 1_000_000 });
  assert.throws(
    () => conferirEstado(s, { app_secret: SEGREDO, agora: 1_000_000 + 11 * 60_000 }),
    (e) => e.reason_code === "APPROVAL_EXPIRED");
  // E ainda vale dentro da janela — senao o teste acima passaria por acidente.
  assert.ok(conferirEstado(s, { app_secret: SEGREDO, agora: 1_000_000 + 60_000 }));
});

test("estado malformado nao derruba o callback com erro cru", () => {
  for (const lixo of ["", "sem-ponto", "a.b.c", null]) {
    assert.throws(() => conferirEstado(lixo, { app_secret: SEGREDO }),
      (e) => e instanceof OAuthError);
  }
});

test("dois estados seguidos diferem: o nonce nao e decorativo", () => {
  const a = assinarEstado({ ...TENANT, app_secret: SEGREDO, agora: 1 });
  const b = assinarEstado({ ...TENANT, app_secret: SEGREDO, agora: 1 });
  assert.notEqual(a, b);
});

test("a URL de autorizacao leva os escopos declarados, e nenhum a mais", () => {
  const url = new URL(urlDeAutorizacao({
    app_id: "123", redirect_uri: "https://olga.test/cb", state: "s1",
  }));
  assert.equal(url.searchParams.get("client_id"), "123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://olga.test/cb");
  assert.equal(url.searchParams.get("state"), "s1");
  // Escopo a mais e permissao que o cliente concede sem que a gente use, e
  // que aparece na tela de consentimento dele como se fosse necessaria.
  assert.deepEqual(url.searchParams.get("scope").split(","), ESCOPOS);
});

test("falta de configuracao e recusa nomeada, nao URL quebrada", () => {
  assert.throws(() => urlDeAutorizacao({ redirect_uri: "https://x", state: "s" }),
    (e) => e.reason_code === "PROVIDER_UNAVAILABLE");
  assert.throws(() => urlDeAutorizacao({ app_id: "1", state: "s" }),
    (e) => e.reason_code === "PROVIDER_UNAVAILABLE");
  assert.throws(() => assinarEstado({ ...TENANT }),
    (e) => e.reason_code === "PROVIDER_UNAVAILABLE");
});

// ── O cliente do Graph, contra um dublê de fetch ───────────────────────────

const respostaDe = (corpo, ok = true, status = 200) => ({
  ok, status, json: async () => corpo,
});

test("a troca de codigo devolve o token e nao o ecoa em lugar nenhum", async () => {
  const chamadas = [];
  const oauth = createMetaOAuth({
    app_id: "1", app_secret: SEGREDO, redirect_uri: "https://olga.test/cb",
    fetch: async (url) => { chamadas.push(url); return respostaDe({ access_token: "tok-curto" }); },
  });
  assert.equal(await oauth.trocarCodigo("code-1"), "tok-curto");
  assert.match(chamadas[0], /\/oauth\/access_token\?/);
});

test("erro do Graph vira CHANNEL_NOT_CONNECTED, sem vazar os parametros", async () => {
  // Os parametros da chamada carregam client_secret e token. A mensagem de
  // erro traz o que a Meta disse, e nada do que nos mandamos.
  const oauth = createMetaOAuth({
    app_id: "1", app_secret: SEGREDO, redirect_uri: "https://olga.test/cb",
    fetch: async () => respostaDe({ error: { message: "Invalid verification code" } }, false, 400),
  });
  await assert.rejects(() => oauth.trocarCodigo("ruim"), (e) => {
    assert.equal(e.reason_code, "CHANNEL_NOT_CONNECTED");
    assert.ok(!e.message.includes(SEGREDO), "a mensagem de erro nao pode carregar o app secret");
    return true;
  });
});

test("Graph inalcancavel e indisponibilidade, e nao conexao invalida", async () => {
  // A diferenca importa para quem opera: uma pede para tentar de novo, a outra
  // pede para reconectar a conta.
  const oauth = createMetaOAuth({
    app_id: "1", app_secret: SEGREDO, redirect_uri: "https://olga.test/cb",
    fetch: async () => { throw new Error("ECONNRESET"); },
  });
  await assert.rejects(() => oauth.trocarPorLongo("t"), (e) => e.reason_code === "PROVIDER_UNAVAILABLE");
});

test("o token longo traz o prazo, porque a conexao precisa avisar antes", async () => {
  const oauth = createMetaOAuth({
    app_id: "1", app_secret: SEGREDO, redirect_uri: "https://olga.test/cb",
    fetch: async () => respostaDe({ access_token: "tok-longo", expires_in: 5_184_000 }),
  });
  assert.deepEqual(await oauth.trocarPorLongo("curto"),
    { token: "tok-longo", expires_in: 5_184_000 });
});

test("so conta Business ligada a Page e publicavel, e a lista diz qual e qual", async () => {
  const oauth = createMetaOAuth({
    app_id: "1", app_secret: SEGREDO, redirect_uri: "https://olga.test/cb",
    fetch: async () => respostaDe({ data: [
      { id: "p1", name: "Corretora", access_token: "tok-page-1",
        instagram_business_account: { id: "ig1", username: "corretora" } },
      { id: "p2", name: "Pessoal", access_token: "tok-page-2" },
    ]}),
  });
  const contas = await oauth.contasDisponiveis("tok-usuario");

  assert.equal(contas.length, 2, "a lista traz tudo; escolher e de quem chamou");
  assert.equal(contas[0].instagram_id, "ig1");
  assert.equal(contas[0].page_token, "tok-page-1",
    "publicar no Instagram usa o token DA PAGE, nao o do usuario");
  assert.equal(contas[1].instagram_id, null,
    "conta sem IG Business aparece marcada, e nao some da lista");
});
