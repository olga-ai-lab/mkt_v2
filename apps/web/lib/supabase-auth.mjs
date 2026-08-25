const AUTH_UNAVAILABLE = "Não foi possível entrar agora. Tente novamente em alguns minutos.";
const INVALID_CREDENTIALS = "E-mail ou senha não conferem.";

export class LoginError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export function authConfig(env = process.env) {
  const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new LoginError(AUTH_UNAVAILABLE, 503);

  let base;
  try { base = new URL(url); }
  catch { throw new LoginError(AUTH_UNAVAILABLE, 503); }
  if (base.protocol !== "https:" && base.hostname !== "localhost") {
    throw new LoginError(AUTH_UNAVAILABLE, 503);
  }
  return { url: base.origin, anonKey };
}

export async function signInWithPassword({ email, password }, { env, fetchImpl = fetch } = {}) {
  if (typeof email !== "string" || !email.includes("@") || typeof password !== "string" || !password) {
    throw new LoginError("Informe um e-mail e uma senha válidos.");
  }

  const config = authConfig(env);
  let response;
  try {
    response = await fetchImpl(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: config.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
      cache: "no-store",
    });
  } catch {
    throw new LoginError(AUTH_UNAVAILABLE, 503);
  }

  if (!response.ok) {
    if (response.status === 400 || response.status === 401) {
      throw new LoginError(INVALID_CREDENTIALS, 401);
    }
    throw new LoginError(AUTH_UNAVAILABLE, 503);
  }

  const session = await response.json();
  if (!session?.access_token || typeof session.expires_in !== "number") {
    throw new LoginError(AUTH_UNAVAILABLE, 503);
  }
  return { accessToken: session.access_token, expiresIn: session.expires_in };
}

export const accessTokenCookie = (secure = process.env.NODE_ENV === "production") => ({
  name: "sb-access-token",
  httpOnly: true,
  sameSite: /** @type {"lax"} */ ("lax"),
  secure,
  path: "/",
});
