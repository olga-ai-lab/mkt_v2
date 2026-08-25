/**
 * Adapter real do Meta Graph (T3) — Instagram e Facebook Page.
 *
 * Implementa o mesmo contrato do adapter falso. O gateway nao distingue um do
 * outro; e por isso que este arquivo pode existir sem tocar em mais nada.
 *
 * ═══ A decisao que este arquivo existe para acertar ═════════════════════════
 *
 * Publicar no Instagram sao DUAS chamadas:
 *
 *   1. POST /{ig_user}/media          cria o container (o rascunho)
 *   2. POST /{ig_user}/media_publish  publica o container
 *
 * As duas falham de jeitos diferentes, e tratar as duas igual e o caminho mais
 * curto para publicar duas vezes:
 *
 *   Falha no passo 1  → tentar de novo e SEGURO. O pior caso e um container
 *                       orfao, que a Meta descarta em 24h. Container nao e post.
 *
 *   Falha no passo 2  → depende de a resposta ter chegado.
 *                       Se a Meta respondeu um erro, sabemos que nao publicou:
 *                       da para classificar com honestidade.
 *                       Se NAO houve resposta (timeout, conexao cortada), nao
 *                       sabemos de nada. O post pode estar no ar.
 *
 * Nesse ultimo caso o adapter marca a falha como NAO retentavel, de proposito.
 * O gateway obedece e para. O item fica FAILED e alguem olha.
 *
 * A alternativa seria tentar de novo e torcer. Entre um item parado que uma
 * pessoa resolve em minutos e um post duplicado no perfil do cliente, que nao
 * da para desfazer sem que alguem tenha visto, a escolha nao e dificil.
 *
 * ═══ Segredo ═══════════════════════════════════════════════════════════════
 *
 * O token nunca vem de mkt.connections: de la vem so o secret_ref (ADR-005).
 * Ele nao entra em log, em trace, em request_hash nem em mensagem de erro.
 */
import { createHash } from "node:crypto";
import { CapabilityError } from "../index.mjs";

const GRAPH = "https://graph.facebook.com";
const API_VERSION = "v21.0";

/**
 * Codigos da Meta que valem retry. Fora desta lista, o padrao e NAO insistir:
 * uma lista de "pode tentar" erra para o lado seguro; uma lista de "nao pode"
 * transformaria todo codigo novo da Meta num retry as cegas.
 */
const RETENTAVEL = new Map([
  [1,   "PROVIDER_UNAVAILABLE"],        // API Unknown — transitorio do lado deles
  [2,   "PROVIDER_UNAVAILABLE"],        // API Service
  [4,   "PROVIDER_RATE_LIMITED"],       // App-level throttling
  [17,  "PROVIDER_RATE_LIMITED"],       // User-level throttling
  [32,  "PROVIDER_RATE_LIMITED"],       // Page-level throttling
  [341, "PROVIDER_RATE_LIMITED"],       // Application limit reached
  [613, "PROVIDER_RATE_LIMITED"],       // Calls to this API have exceeded the rate limit
]);

/** Codigos que significam "esta conexao nao serve" — nao adianta insistir. */
const CONEXAO_INVALIDA = new Set([
  102,  // sessao expirada
  190,  // OAuthException: token invalido ou revogado
  200,  // permissao faltando
  10,   // permissao nao concedida
  463,  // sessao expirada
  467,  // token invalido
  3,    // capability desabilitada para o app
]);

export class MetaAdapterError extends CapabilityError {}

const naoRetentavel = (reason_code, message, extra = {}) =>
  new MetaAdapterError(reason_code, message, { error_class: "PERMANENT", retryable: false, ...extra });

const retentavel = (reason_code, message, extra = {}) =>
  new MetaAdapterError(reason_code, message, { error_class: "TRANSIENT", retryable: true, ...extra });

/** Hash estavel do pedido, para o receipt. Sem token, sem dado volatil. */
export function hashRequest(obj) {
  const canonico = (v) => {
    if (Array.isArray(v)) return v.map(canonico);
    if (v && typeof v === "object") {
      return Object.keys(v).sort().reduce((acc, k) => { acc[k] = canonico(v[k]); return acc; }, {});
    }
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canonico(obj))).digest("hex");
}

/**
 * @param {{ connections: any, secrets: any, variants: any,
 *           fetch?: typeof globalThis.fetch, baseUrl?: string,
 *           apiVersion?: string, tracer?: any }} deps
 */
export function createMetaGraphAdapter({
  connections, secrets, variants,
  fetch: doFetch = globalThis.fetch,
  baseUrl = GRAPH, apiVersion = API_VERSION, tracer,
} = {}) {
  if (!connections || !secrets || !variants) {
    throw new Error("adapter meta_graph exige as portas connections, secrets e variants");
  }

  /**
   * Uma chamada ao Graph.
   *
   * @param {boolean} ambiguoSeSemResposta  quando true, falha de rede vira
   *   PERMANENT: e o passo em que "nao sei" tem de significar "nao tente".
   */
  async function chamar(caminho, corpo, { token, timeout_ms, ambiguoSeSemResposta = false }) {
    const url = `${baseUrl}/${apiVersion}/${caminho}`;
    let resposta;

    try {
      resposta = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeout_ms),
      });
    } catch (e) {
      // Sem resposta: nao existe informacao sobre o que aconteceu do outro lado.
      const msg = e?.name === "TimeoutError" || e?.name === "AbortError"
        ? "o provider nao respondeu no tempo"
        : "falha de rede antes da resposta";
      throw ambiguoSeSemResposta
        ? naoRetentavel("PROVIDER_UNAVAILABLE",
            `${msg} durante a publicacao; pode ter sido publicado, nao vamos repetir`,
            { provider_message: msg, ambiguous: true })
        : retentavel("PROVIDER_UNAVAILABLE", msg, { provider_message: msg });
    }

    let json = null;
    try { json = await resposta.json(); } catch { /* corpo nao-JSON tratado abaixo */ }

    if (resposta.ok && json && !json.error) return json;

    const err = json?.error ?? {};
    const codigo = Number(err.code);
    const detalhe = err.message ?? `HTTP ${resposta.status}`;

    tracer?.event?.({
      event: "meta_graph.error", status: resposta.status,
      code: err.code, subcode: err.error_subcode, fbtrace_id: err.fbtrace_id,
    });

    // A Meta ja publicou este conteudo. Nao e falha nossa e repetir e o oposto
    // do que se quer: e a propria protecao contra duplicata funcionando.
    if (codigo === 506) {
      throw naoRetentavel("DUPLICATE_OPERATION_PREVENTED",
        "o provider recusou por duplicidade", { provider_message: detalhe });
    }

    if (CONEXAO_INVALIDA.has(codigo)) {
      throw naoRetentavel("CHANNEL_NOT_CONNECTED",
        "a conexao com o canal nao esta valida", { provider_message: detalhe });
    }

    if (RETENTAVEL.has(codigo)) {
      throw retentavel(RETENTAVEL.get(codigo), detalhe, { provider_message: detalhe });
    }

    if (resposta.status === 429) {
      throw retentavel("PROVIDER_RATE_LIMITED", detalhe, { provider_message: detalhe });
    }

    // 5xx e do lado deles e costuma passar. Mas se for no passo de publicar,
    // um 5xx pode ter chegado DEPOIS de o post entrar: mesma ambiguidade.
    if (resposta.status >= 500) {
      throw ambiguoSeSemResposta
        ? naoRetentavel("PROVIDER_UNAVAILABLE",
            "erro do provider durante a publicacao; pode ter sido publicado",
            { provider_message: detalhe, ambiguous: true })
        : retentavel("PROVIDER_UNAVAILABLE", detalhe, { provider_message: detalhe });
    }

    // 4xx desconhecido: pedido malformado nosso. Insistir so repete o erro.
    throw naoRetentavel("PROVIDER_UNAVAILABLE", detalhe, { provider_message: detalhe });
  }

  async function resolverConexao(connection_id, tenant) {
    const conn = await connections.get(connection_id);
    if (!conn) throw naoRetentavel("CHANNEL_NOT_CONNECTED", "conexao inexistente");

    // Defesa em profundidade: a RLS ja separa, o gateway ja checou o tenant.
    // Uma conexao de outra org chegando aqui e sinal de bug, nao de ataque
    // bem-sucedido — e mesmo assim para aqui.
    if (tenant?.org_id && String(conn.org_id) !== String(tenant.org_id)) {
      throw naoRetentavel("TENANT_SCOPE_VIOLATION", "conexao de outra organizacao");
    }
    if (conn.status !== "ACTIVE") {
      throw naoRetentavel("CHANNEL_NOT_CONNECTED", `conexao esta ${conn.status}`);
    }
    if (conn.expires_at && new Date(conn.expires_at).getTime() <= Date.now()) {
      throw naoRetentavel("CHANNEL_NOT_CONNECTED", "credencial expirada");
    }

    const token = await secrets.resolve(conn.secret_ref);
    if (!token) throw naoRetentavel("CHANNEL_NOT_CONNECTED", "credencial nao encontrada no vault");

    return { conn, token };
  }

  return {
    name: "meta_graph",

    async call({ capability, request, idempotency_key, trace_id }) {
      const timeout_ms = capability?.timeout_ms ?? 45000;
      const { channel, connection_id, channel_variant_id } = request.args ?? {};

      const { conn, token } = await resolverConexao(connection_id, request.tenant);

      if (conn.channel !== channel) {
        throw naoRetentavel("SCHEMA_VALIDATION_FAILED",
          `conexao e de ${conn.channel}, pedido e de ${channel}`);
      }

      const variante = await variants.get(channel_variant_id);
      if (!variante) throw naoRetentavel("SCHEMA_VALIDATION_FAILED", "variante de canal inexistente");

      const texto = [variante.headline, variante.body, variante.cta].filter(Boolean).join("\n\n");
      const assets = Array.isArray(variante.asset_refs) ? variante.asset_refs : [];

      // O hash e do que foi PEDIDO, nao do que voltou: e o que permite comparar
      // duas tentativas e afirmar que pediram a mesma coisa.
      const request_hash = hashRequest({ channel, connection_id, channel_variant_id, texto, assets });

      tracer?.event?.({ trace_id, event: "meta_graph.publishing", channel, idempotency_key });

      if (channel === "INSTAGRAM") {
        const imagem = assets[0]?.url ?? assets[0];
        if (!imagem) {
          throw naoRetentavel("SCHEMA_VALIDATION_FAILED", "Instagram exige ao menos uma imagem");
        }

        // Passo 1: container. Falhar aqui e seguro para repetir.
        const container = await chamar(
          `${conn.external_account_id}/media`,
          { image_url: imagem, caption: texto },
          { token, timeout_ms, ambiguoSeSemResposta: false },
        );
        if (!container?.id) {
          throw naoRetentavel("PROVIDER_UNAVAILABLE", "provider nao devolveu o container");
        }

        // Passo 2: publicar. A partir daqui, "nao sei" significa "nao repita".
        const post = await chamar(
          `${conn.external_account_id}/media_publish`,
          { creation_id: container.id },
          { token, timeout_ms, ambiguoSeSemResposta: true },
        );
        if (!post?.id) {
          throw naoRetentavel("PROVIDER_UNAVAILABLE", "provider nao devolveu o id do post");
        }

        return { external_id: String(post.id), request_hash };
      }

      if (channel === "FACEBOOK") {
        // Uma chamada so: ou publicou, ou nao. Mas a ambiguidade de rede e a
        // mesma, e por isso o passo unico tambem e tratado como publicacao.
        const post = await chamar(
          `${conn.external_account_id}/feed`,
          { message: texto, ...(assets[0]?.url ? { link: assets[0].url } : {}) },
          { token, timeout_ms, ambiguoSeSemResposta: true },
        );
        if (!post?.id) {
          throw naoRetentavel("PROVIDER_UNAVAILABLE", "provider nao devolveu o id do post");
        }
        return { external_id: String(post.id), request_hash };
      }

      throw naoRetentavel("UNSUPPORTED_VALUE", `canal sem suporte no meta_graph: ${channel}`);
    },
  };
}
