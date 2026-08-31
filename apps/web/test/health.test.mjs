/**
 * A rota de saúde não vaza segredo, e cobre o que realmente quebra.
 *
 * ── Por que testar o TEXTO da rota, e não só o comportamento ───────────────
 *
 * A versão perigosa desta rota não é a que erra: é a que alguém "melhora" num
 * dia ruim de depuração. `process.env.DATABASE_URL.slice(0, 30)` para conferir
 * o host, `chave: process.env.ANTHROPIC_API_KEY?.slice(-4)` para saber qual é.
 * Ambos parecem inofensivos, ambos publicam segredo numa rota aberta, e nenhum
 * teste de comportamento pega — a resposta continua "funcionando".
 *
 * Então a regra é sobre a FORMA do código: toda leitura de `process.env` desta
 * rota passa por `Boolean(...)`, por comparação, ou por uma lista de nomes.
 * Nenhum valor sai inteiro no JSON.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROTA = readFileSync(new URL("../app/api/health/route.ts", import.meta.url), "utf8");

/** Sem comentário: o cabeçalho desta rota CITA o padrão perigoso, de propósito. */
const semComentario = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("nenhum valor de variavel de ambiente sai na resposta", () => {
  const codigo = semComentario(ROTA);

  // Os usos legítimos: dentro de Boolean(), comparado com algo, com fallback
  // para constante conhecida, ou fatiado a 8 caracteres (o commit, que é
  // público). Qualquer outro uso é o valor cru indo para o JSON.
  const PERMITIDOS = [
    /process\.env\[nome\]/,                                   // tem()
    /process\.env\.MKT_SCHEMA \|\| "mkt"/,
    /process\.env\.VERCEL_GIT_COMMIT_REF \?\? null/,
    /^process\.env\.VERCEL_GIT_COMMIT_SHA \?\? ""\)\.slice\(0, 8\)/,
    /process\.env\.VERCEL_ENV \?\? process\.env\.NODE_ENV \?\? null/,
    /^process\.env\.META_ADAPTER \?\? "fake"\) === "fake"/,
  ];

  const usos = [...codigo.matchAll(/process\.env[.[][^\n]*/g)].map((m) => m[0]);
  const suspeitos = usos.filter((u) => !PERMITIDOS.some((p) => p.test(u)));

  assert.deepEqual(suspeitos, [],
    "leitura de process.env que pode publicar o VALOR numa rota aberta:\n  " +
    suspeitos.join("\n  "));
});

test("o segredo nunca aparece fatiado, nem 'so o comeco'", () => {
  const codigo = semComentario(ROTA);
  for (const segredo of ["DATABASE_URL", "SUPABASE_JWT_SECRET", "ANTHROPIC_API_KEY",
                         "SUPABASE_ANON_KEY", "INNGEST_EVENT_KEY"]) {
    const fatiado = new RegExp(`${segredo}[^\\n]*\\.(slice|substring|substr|at)\\(`);
    assert.ok(!fatiado.test(codigo), `${segredo} aparece fatiado — "so o comeco" e o valor`);
  }
});

test("a mensagem de erro do Postgres nao vai para a resposta", () => {
  // `e.message` de uma falha de conexao carrega host e porta. Sai o `code`.
  const codigo = semComentario(ROTA);
  assert.ok(!/erro:\s*\(?e[^\n]*\.message/.test(codigo),
    "a mensagem do driver pode conter host e credencial; use o code");
  assert.match(codigo, /\.code \?\?/);
});

test("cobre as cinco variaveis sem as quais algo quebra", () => {
  for (const v of ["DATABASE_URL", "SUPABASE_JWT_SECRET", "SUPABASE_URL",
                   "SUPABASE_ANON_KEY", "ANTHROPIC_API_KEY"]) {
    assert.ok(ROTA.includes(`"${v}"`), `a rota de saude nao confere ${v}`);
  }
});

test("o nome do schema e validado antes de entrar na consulta", () => {
  // Nao existe placeholder para identificador em SQL: o schema entra por
  // interpolacao, entao a validacao e a unica coisa entre ele e uma injecao.
  assert.match(ROTA, /\^\[a-z\]\[a-z0-9_\]\*\$/,
    "o schema entra na consulta por interpolacao e precisa ser validado antes");
});

test("responde 503, e nao 200, quando falta o essencial", () => {
  // Um health check que devolve 200 sempre e um health check decorativo: todo
  // monitor externo olha o status, nao o corpo.
  assert.match(ROTA, /status: ok \? 200 : 503/);
});
