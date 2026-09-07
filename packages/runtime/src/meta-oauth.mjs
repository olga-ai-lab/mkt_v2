/**
 * O consentimento da Meta: o passo que acontece no navegador de uma pessoa.
 *
 * `channel.connect` nao esta no charter de agente nenhum, e nao e esquecimento:
 * conectar uma conta e um ato de consentimento, e quem consente e o dono da
 * conta, num navegador, olhando para a tela da Meta. Nenhum agente pode fazer
 * isso por ele.
 *
 * Este modulo e a parte que da para provar sem rede: montar a URL de
 * autorizacao, assinar e conferir o `state`, e traduzir as respostas do Graph
 * em objetos nossos. O `fetch` entra por parametro — os testes rodam contra um
 * dublê, e a producao contra a Meta, pelo mesmo caminho.
 *
 * ── O que este modulo NUNCA faz ────────────────────────────────────────────
 *
 * Ele nao guarda token. Ele DEVOLVE o token para quem chamou, e quem chamou
 * tem de entrega-lo a um vault com escrita. A separacao e proposital: enquanto
 * o token estiver aqui, ele esta numa variavel; se este arquivo soubesse
 * grava-lo, existiria um caminho por onde ele acabaria no banco de dominio, e
 * o invariante "segredo nunca no banco de dominio" viraria uma questao de
 * disciplina em vez de estrutura.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com";
const API_VERSION = "v21.0";

/**
 * Os escopos pedidos, e por que cada um.
 *
 * A lista e curta de proposito: escopo a mais e permissao que o cliente
 * concede sem que a gente use, e que aparece na tela de consentimento dele
 * como se fosse necessaria.
 */
export const ESCOPOS = [
  "pages_show_list",              // descobrir quais Pages a pessoa administra
  "pages_read_engagement",        // ler o nome/id da Page para exibir na tela
  "instagram_basic",              // ler a conta IG ligada a Page
  "instagram_content_publish",    // o unico escopo de escrita, e o motivo de tudo
  "business_management",          // exigido pela Meta para contas em Business Manager
];

export class OAuthError extends Error {
  constructor(reason_code, message) {
    super(message);
    this.reason_code = reason_code;
  }
}

/**
 * Chave de assinatura do `state`, derivada do app secret.
 *
 * Derivar em vez de usar o app secret direto: se algum dia um `state`
 * assinado vazar, ele nao serve para falar com a Meta em nome do app. E evita
 * inventar uma variavel de ambiente nova para um segredo que ja existe.
 */
const chaveDeEstado = (app_secret) =>
  createHmac("sha256", String(app_secret)).update("olga:oauth:state:v1").digest();

/**
 * Assina o estado da conversa de OAuth.
 *
 * O `state` carrega tenant e um nonce, e volta assinado. Sem assinatura, o
 * callback aceitaria um `state` fabricado e um atacante escolheria em qual
 * workspace a conexao dele seria gravada — que e CSRF com consequencia de
 * tenant, o pior tipo.
 */
/**
 * @param {{ org_id: string, workspace_id: string, user_id?: string,
 *           app_secret?: string, agora?: number, nonce?: string }} args
 */
export function assinarEstado({ org_id, workspace_id, user_id, app_secret, agora = Date.now(), nonce }) {
  if (!app_secret) throw new OAuthError("PROVIDER_UNAVAILABLE", "META_APP_SECRET nao configurado");
  const corpo = JSON.stringify({
    org_id, workspace_id, user_id,
    n: nonce ?? randomBytes(9).toString("base64url"),
    t: agora,
  });
  const dados = Buffer.from(corpo).toString("base64url");
  const mac = createHmac("sha256", chaveDeEstado(app_secret)).update(dados).digest("base64url");
  return `${dados}.${mac}`;
}

/**
 * Confere o estado e devolve o tenant que ele carrega.
 *
 * Duas defesas, e nenhuma delas e opcional:
 * - `timingSafeEqual`, pela mesma razao que a verificacao de JWT usa;
 * - validade de 10 minutos, porque um `state` sem prazo e um convite
 *   permanente que basta capturar uma vez.
 */
/**
 * @param {string|null|undefined} state
 * @param {{ app_secret?: string, agora?: number, validade_ms?: number }} [opcoes]
 */
export function conferirEstado(state, { app_secret, agora = Date.now(), validade_ms = 10 * 60_000 } = {}) {
  const partes = String(state ?? "").split(".");
  if (partes.length !== 2) throw new OAuthError("SCHEMA_VALIDATION_FAILED", "state malformado");

  const [dados, mac] = partes;
  const esperado = createHmac("sha256", chaveDeEstado(app_secret)).update(dados).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new OAuthError("TENANT_SCOPE_VIOLATION", "state com assinatura invalida");
  }

  let corpo;
  try {
    corpo = JSON.parse(Buffer.from(dados, "base64url").toString("utf8"));
  } catch {
    throw new OAuthError("SCHEMA_VALIDATION_FAILED", "state ilegivel");
  }

  if (!corpo.org_id || !corpo.workspace_id) {
    throw new OAuthError("TENANT_SCOPE_VIOLATION", "state sem tenant");
  }
  if (!(agora - Number(corpo.t) < validade_ms)) {
    throw new OAuthError("APPROVAL_EXPIRED", "state expirado");
  }
  return { org_id: corpo.org_id, workspace_id: corpo.workspace_id, user_id: corpo.user_id };
}

/** A URL para onde a pessoa e mandada. */
/**
 * @param {{ app_id?: string, redirect_uri?: string, state: string, escopos?: string[] }} args
 */
export function urlDeAutorizacao({ app_id, redirect_uri, state, escopos = ESCOPOS }) {
  if (!app_id) throw new OAuthError("PROVIDER_UNAVAILABLE", "META_APP_ID nao configurado");
  if (!redirect_uri) throw new OAuthError("PROVIDER_UNAVAILABLE", "META_REDIRECT_URI nao configurado");
  const q = new URLSearchParams({
    client_id: app_id, redirect_uri, state,
    scope: escopos.join(","), response_type: "code",
  });
  return `https://www.facebook.com/${API_VERSION}/dialog/oauth?${q}`;
}

/**
 * O cliente do Graph usado no consentimento.
 *
 * Separado do adapter de publicacao de proposito: aquele fala em nome de uma
 * conexao ja estabelecida e vive atras do Capability Gateway; este fala em
 * nome do app para ESTABELECER a conexao, e roda no request de uma pessoa.
 * Junta-los faria o gateway parecer o caminho de um efeito que ele nao media.
 */
/**
 * @param {{ app_id: string, app_secret: string, redirect_uri: string,
 *           fetch?: typeof globalThis.fetch }} deps
 */
export function createMetaOAuth({ app_id, app_secret, redirect_uri, fetch: doFetch = fetch }) {
  async function graph(caminho, params) {
    const url = `${GRAPH}/${API_VERSION}${caminho}?${new URLSearchParams(params)}`;
    let r;
    try {
      r = await doFetch(url, { method: "GET" });
    } catch (e) {
      throw new OAuthError("PROVIDER_UNAVAILABLE", `Graph inalcancavel: ${e?.message ?? e}`);
    }
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok || corpo.error) {
      // A mensagem da Meta entra no erro, mas o token jamais: `params` nao e
      // ecoado aqui, e e ele que carrega segredo.
      throw new OAuthError("CHANNEL_NOT_CONNECTED",
        corpo?.error?.message ?? `Graph respondeu ${r.status}`);
    }
    return corpo;
  }

  return {
    /** Troca o `code` do callback por um token de curta duracao. */
    async trocarCodigo(code) {
      const r = await graph("/oauth/access_token", {
        client_id: app_id, client_secret: app_secret, redirect_uri, code,
      });
      if (!r.access_token) throw new OAuthError("CHANNEL_NOT_CONNECTED", "Graph nao devolveu token");
      return r.access_token;
    },

    /**
     * Troca o token curto pelo longo (60 dias).
     *
     * Sem este passo a conexao morre em horas e o cliente descobre pelo post
     * que nao saiu. `expires_in` volta junto porque `connections.expires_at`
     * existe para que a gente avise ANTES.
     */
    async trocarPorLongo(token_curto) {
      const r = await graph("/oauth/access_token", {
        grant_type: "fb_exchange_token",
        client_id: app_id, client_secret: app_secret, fb_exchange_token: token_curto,
      });
      if (!r.access_token) throw new OAuthError("CHANNEL_NOT_CONNECTED", "Graph nao devolveu token longo");
      return { token: r.access_token, expires_in: r.expires_in ?? null };
    },

    /**
     * As contas que aquela pessoa pode publicar.
     *
     * Publicar no Instagram exige a conta Business ligada a uma Page, e o
     * token que serve e o token DA PAGE, nao o do usuario. Devolver a lista em
     * vez de escolher uma e deliberado: escolher por ela seria conectar uma
     * conta que ela nao apontou.
     */
    async contasDisponiveis(token_usuario) {
      const r = await graph("/me/accounts", {
        access_token: token_usuario,
        fields: "id,name,access_token,instagram_business_account{id,username}",
      });
      return (r.data ?? []).map((p) => ({
        page_id: p.id,
        page_name: p.name,
        page_token: p.access_token,
        instagram_id: p.instagram_business_account?.id ?? null,
        instagram_username: p.instagram_business_account?.username ?? null,
      }));
    },
  };
}
