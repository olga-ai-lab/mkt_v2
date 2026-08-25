/**
 * Verificacao de sessao — a parte que da para testar sem HTTP e sem banco.
 *
 * Fica em .mjs, e nao dentro do route handler, pelo mesmo motivo de todo o
 * resto do repositorio: decisao em modulo testavel, handler fino em cima.
 *
 * O que este arquivo NAO faz e tao importante quanto o que faz: ele nunca le
 * org_id, workspace_id ou papel do corpo do pedido. Tenant vem da sessao
 * assinada e e revalidado contra a membership no banco (MKT-09B §5).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export class SessionError extends Error {
  constructor(reason_code, message) {
    super(message ?? reason_code);
    this.reason_code = reason_code;
  }
}

const b64urlToBuf = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** Extrai o token de Authorization: Bearer ou do cookie do Supabase. */
/**
 * @param {{ authorization?: string|null, cookie?: string|null }} [origem]
 * @returns {string|null}
 */
export function extractToken({ authorization = null, cookie = null } = {}) {
  if (authorization) {
    const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (m) return m[1].trim();
  }
  if (cookie) {
    const m = /(?:^|;\s*)sb-access-token=([^;]+)/.exec(cookie);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

/**
 * Verifica um JWT HS256 e devolve as claims.
 *
 * Assinatura conferida com timingSafeEqual: comparar hash com === vaza, por
 * tempo de resposta, quanto do prefixo estava certo.
 */
/**
 * @param {string|null} token
 * @param {string|undefined} secret
 * @param {{ now?: () => number, leewaySeconds?: number }} [opcoes]
 * @returns {Record<string, any>}
 */
export function verifyJwtHS256(token, secret, { now = Date.now, leewaySeconds = 0 } = {}) {
  if (!token) throw new SessionError("ACTOR_ROLE_FORBIDDEN", "sem token");
  if (!secret) throw new SessionError("PROVIDER_UNAVAILABLE", "SUPABASE_JWT_SECRET nao configurado");

  const partes = token.split(".");
  if (partes.length !== 3) throw new SessionError("ACTOR_ROLE_FORBIDDEN", "token malformado");
  const [h, p, s] = partes;

  let header;
  try { header = JSON.parse(b64urlToBuf(h).toString("utf8")); }
  catch { throw new SessionError("ACTOR_ROLE_FORBIDDEN", "header ilegivel"); }

  // `alg: none` e a variante classica: aceitar o algoritmo que o token declara
  // e deixar o atacante escolher se havera verificacao.
  if (header.alg !== "HS256") {
    throw new SessionError("ACTOR_ROLE_FORBIDDEN", `algoritmo recusado: ${header.alg}`);
  }

  const esperada = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const recebida = b64urlToBuf(s);
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    throw new SessionError("ACTOR_ROLE_FORBIDDEN", "assinatura invalida");
  }

  let claims;
  try { claims = JSON.parse(b64urlToBuf(p).toString("utf8")); }
  catch { throw new SessionError("ACTOR_ROLE_FORBIDDEN", "claims ilegiveis"); }

  const agora = Math.floor(now() / 1000);
  if (typeof claims.exp === "number" && agora > claims.exp + leewaySeconds) {
    throw new SessionError("ACTOR_ROLE_FORBIDDEN", "sessao expirada");
  }
  if (typeof claims.nbf === "number" && agora + leewaySeconds < claims.nbf) {
    throw new SessionError("ACTOR_ROLE_FORBIDDEN", "token ainda nao vale");
  }
  if (!claims.sub) throw new SessionError("ACTOR_ROLE_FORBIDDEN", "token sem sujeito");

  return claims;
}

/**
 * Escolhe o workspace da requisicao entre os que a pessoa realmente alcanca.
 *
 * O pedido pode SUGERIR um workspace (troca de contexto na interface), mas a
 * lista de permitidos vem do banco. Sugerir um workspace de outra organizacao
 * nao devolve erro generico: devolve TENANT_SCOPE_VIOLATION, porque e disso
 * que se trata.
 */
/**
 * @param {Array<{ org_id: string, workspace_id: string, role: string }>} memberships
 * @param {string|null} [pedido]
 */
export function resolveWorkspace(memberships, pedido = null) {
  const primeiro = memberships?.[0];
  if (!primeiro) throw new SessionError("ACTOR_ROLE_FORBIDDEN", "usuario sem membership");
  if (pedido == null) return primeiro;

  const achado = memberships.find((m) => String(m.workspace_id) === String(pedido));
  if (!achado) throw new SessionError("TENANT_SCOPE_VIOLATION", "workspace fora do alcance do usuario");
  return achado;
}
