/**
 * Contexto confiavel de uma requisicao.
 *
 * Regra que este arquivo existe para sustentar: tenant e papel NUNCA vem do
 * corpo do pedido. Vem do token assinado e sao revalidados contra
 * mkt.memberships no banco a cada requisicao (MKT-09B §5).
 *
 * A logica verificavel mora em ./session.mjs, que roda em teste sem HTTP.
 *
 * A assinatura pede o MINIMO que a funcao usa — headers e query — em vez de um
 * NextRequest inteiro. Assim a mesma funcao serve route handler e server
 * component, sem ninguem precisar fabricar um request falso para chamar.
 */
import { extractToken, verifyJwtHS256, resolveWorkspace, SessionError } from "./session.mjs";
import { pool } from "./db";

export type TrustedContext = {
  user_id: string;
  org_id: string;
  workspace_id: string;
  role: string;
};

/** O que basta para identificar quem esta pedindo. */
export type RequestLike = {
  headers: { get(name: string): string | null };
  searchParams?: URLSearchParams;
};

export { SessionError };

export async function getTrustedContext(request: RequestLike): Promise<TrustedContext | null> {
  const token = extractToken({
    authorization: request.headers.get("authorization"),
    cookie: request.headers.get("cookie"),
  });
  if (!token) return null;

  let claims: { sub: string };
  try {
    claims = verifyJwtHS256(token, process.env.SUPABASE_JWT_SECRET) as { sub: string };
  } catch {
    return null;
  }

  // O papel vem da membership, nao da claim: um token com role forjada nao
  // pode virar permissao. A claim so diz QUEM e; o banco diz o que pode.
  const { rows } = await pool.query(
    `select m.org_id, m.role::text as role, w.id as workspace_id
       from mkt.memberships m
       join mkt.workspaces w on w.org_id = m.org_id
      where m.user_id = $1
      order by w.created_at asc`,
    [claims.sub],
  );
  if (rows.length === 0) return null;

  const pedido =
    request.headers.get("x-olga-workspace") ?? request.searchParams?.get("workspace_id") ?? null;
  const escolhido = resolveWorkspace(rows, pedido);

  return {
    user_id: claims.sub,
    org_id: escolhido.org_id,
    workspace_id: escolhido.workspace_id,
    role: escolhido.role,
  };
}
