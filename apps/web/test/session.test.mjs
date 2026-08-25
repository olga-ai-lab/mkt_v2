import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { extractToken, verifyJwtHS256, resolveWorkspace } from "../lib/session.mjs";

const SEGREDO = "segredo-de-teste";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function jwt(claims, { alg = "HS256", secret = SEGREDO, assinatura = null } = {}) {
  const h = b64({ alg, typ: "JWT" });
  const p = b64(claims);
  const s = assinatura ?? createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

const daquiAUmaHora = () => Math.floor(Date.now() / 1000) + 3600;

test("le o token do header Bearer e do cookie do Supabase", () => {
  assert.equal(extractToken({ authorization: "Bearer abc.def.ghi" }), "abc.def.ghi");
  assert.equal(extractToken({ authorization: "bearer  abc.def.ghi  " }), "abc.def.ghi");
  assert.equal(extractToken({ cookie: "outro=1; sb-access-token=xyz; mais=2" }), "xyz");
  assert.equal(extractToken({}), null);
});

test("token valido devolve as claims", () => {
  const c = verifyJwtHS256(jwt({ sub: "u1", exp: daquiAUmaHora() }), SEGREDO);
  assert.equal(c.sub, "u1");
});

test("assinatura de outro segredo e recusada", () => {
  const t = jwt({ sub: "u1", exp: daquiAUmaHora() }, { secret: "outro-segredo" });
  assert.throws(() => verifyJwtHS256(t, SEGREDO), /assinatura invalida/);
});

test("alg none e recusado — o token nao escolhe se sera verificado", () => {
  const t = jwt({ sub: "u1", exp: daquiAUmaHora() }, { alg: "none", assinatura: "" });
  assert.throws(() => verifyJwtHS256(t, SEGREDO), /algoritmo recusado/);
});

test("trocar o algoritmo para RS256 nao passa pela verificacao HMAC", () => {
  const t = jwt({ sub: "u1", exp: daquiAUmaHora() }, { alg: "RS256" });
  assert.throws(() => verifyJwtHS256(t, SEGREDO), /algoritmo recusado/);
});

test("token expirado e recusado", () => {
  const t = jwt({ sub: "u1", exp: Math.floor(Date.now() / 1000) - 10 });
  assert.throws(() => verifyJwtHS256(t, SEGREDO), /expirada/);
});

test("token sem sujeito nao identifica ninguem", () => {
  assert.throws(() => verifyJwtHS256(jwt({ exp: daquiAUmaHora() }), SEGREDO), /sem sujeito/);
});

test("payload adulterado invalida a assinatura", () => {
  const bom = jwt({ sub: "u1", exp: daquiAUmaHora() });
  const [h, , s] = bom.split(".");
  const adulterado = `${h}.${b64({ sub: "admin", exp: daquiAUmaHora() })}.${s}`;
  assert.throws(() => verifyJwtHS256(adulterado, SEGREDO), /assinatura invalida/);
});

test("sem segredo configurado, falha em vez de aceitar qualquer coisa", () => {
  assert.throws(() => verifyJwtHS256(jwt({ sub: "u1" }), undefined),
    (e) => e.reason_code === "PROVIDER_UNAVAILABLE");
});

// ── Escopo de tenant ────────────────────────────────────────────────────────

const MEMBERSHIPS = [
  { org_id: "orgA", workspace_id: "wsA", role: "OWNER" },
  { org_id: "orgA", workspace_id: "wsA2", role: "OWNER" },
];

test("sem pedido explicito, usa o primeiro workspace da pessoa", () => {
  assert.equal(resolveWorkspace(MEMBERSHIPS).workspace_id, "wsA");
});

test("pedir um workspace que a pessoa alcanca funciona", () => {
  assert.equal(resolveWorkspace(MEMBERSHIPS, "wsA2").workspace_id, "wsA2");
});

test("pedir workspace de outra org e TENANT_SCOPE_VIOLATION, nao 'nao encontrado'", () => {
  assert.throws(() => resolveWorkspace(MEMBERSHIPS, "wsDeOutraOrg"),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION");
});

test("usuario sem membership nao ganha workspace por omissao", () => {
  assert.throws(() => resolveWorkspace([], null), (e) => e.reason_code === "ACTOR_ROLE_FORBIDDEN");
});
