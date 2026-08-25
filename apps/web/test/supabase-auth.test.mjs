import test from "node:test";
import assert from "node:assert/strict";
import { accessTokenCookie, authConfig, signInWithPassword } from "../lib/supabase-auth.mjs";

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_ANON_KEY: "anon" };

test("configuracao de auth exige URL e anon key", () => {
  assert.throws(() => authConfig({}), (error) => error.status === 503);
  assert.deepEqual(authConfig(env), { url: env.SUPABASE_URL, anonKey: "anon" });
});

test("login envia credenciais ao endpoint GoTrue sem expor a senha na URL", async () => {
  let call;
  const session = await signInWithPassword({ email: "ana@example.com", password: "segredo" }, {
    env,
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, json: async () => ({ access_token: "jwt", expires_in: 3600 }) };
    },
  });
  assert.equal(call.url, `${env.SUPABASE_URL}/auth/v1/token?grant_type=password`);
  assert.equal(call.options.headers.apikey, "anon");
  assert.deepEqual(JSON.parse(call.options.body), { email: "ana@example.com", password: "segredo" });
  assert.deepEqual(session, { accessToken: "jwt", expiresIn: 3600 });
});

test("credencial recusada recebe mensagem segura em vez da resposta do provider", async () => {
  await assert.rejects(
    signInWithPassword({ email: "ana@example.com", password: "errada" }, {
      env, fetchImpl: async () => ({ ok: false, status: 400 }),
    }),
    (error) => error.status === 401 && error.message === "E-mail ou senha não conferem.",
  );
});

test("cookie de sessão é HttpOnly e não atravessa sites", () => {
  assert.deepEqual(accessTokenCookie(false), {
    name: "sb-access-token", httpOnly: true, sameSite: "lax", secure: false, path: "/",
  });
});
