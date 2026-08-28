/**
 * Toda variavel que o servidor le esta declarada no .env.example.
 *
 * ── Por que isto e teste e nao combinado ───────────────────────────────────
 *
 * Variavel esquecida e a causa mais comum de deploy que builda e nao roda. O
 * build nao le `process.env`; a primeira requisicao le. Entao o sintoma e
 * sempre o mesmo: verde no CI, verde no deploy, 500 ou 503 na primeira pessoa
 * que abre a tela.
 *
 * O `.env.example` e a unica lista que alguem consulta ao configurar um
 * ambiente novo — e uma lista incompleta e pior que nenhuma, porque quem a
 * segue acredita ter terminado. Quando este teste foi escrito, faltavam
 * `MKT_SCHEMA` e `SUPABASE_JWT_SECRET`: sem a primeira o produto escreve no
 * schema errado, sem a segunda o login nao acontece.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("../../../", import.meta.url));
const EXEMPLO = readFileSync(join(RAIZ, ".env.example"), "utf8");

/** Onde roda codigo de servidor que le configuracao. */
const SERVIDOR = [
  "packages/contracts/src", "packages/runtime/src", "packages/gateway/src",
  "packages/policy/src", "apps/worker/src", "apps/web/lib", "apps/web/app",
];

/**
 * Variaveis que o ambiente fornece sozinho. Declara-las no exemplo sugeriria
 * que alguem precisa preenche-las, e a lista existe para dizer o contrario.
 */
const DO_AMBIENTE = new Set(["NODE_ENV", "TMPDIR", "PORT", "VERCEL", "VERCEL_ENV"]);

function fontes(dir) {
  const saida = [];
  const anda = (p) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const f = join(p, e.name);
      if (e.isDirectory()) anda(f);
      else if (/\.(mjs|ts|tsx|js)$/.test(e.name)) saida.push(f);
    }
  };
  anda(join(RAIZ, dir));
  return saida;
}

/** Sem comentario: um `process.env.X` citado em prosa nao e uso. */
const semComentario = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("toda variavel lida pelo servidor esta no .env.example", () => {
  const usadas = new Set();
  for (const dir of SERVIDOR) {
    for (const arquivo of fontes(dir)) {
      const texto = semComentario(readFileSync(arquivo, "utf8"));
      for (const m of texto.matchAll(/\benv\.([A-Z][A-Z_0-9]{2,})\b/g)) usadas.add(m[1]);
    }
  }
  assert.ok(usadas.size > 5, `so achei ${usadas.size} variaveis; o regex quebrou?`);

  const declaradas = new Set(
    [...EXEMPLO.matchAll(/^([A-Z][A-Z_0-9]*)=/gm)].map((m) => m[1]));

  const faltando = [...usadas].filter((v) => !DO_AMBIENTE.has(v) && !declaradas.has(v)).sort();
  assert.deepEqual(faltando, [],
    "o codigo le estas variaveis e o .env.example nao as declara — quem " +
    `configurar um ambiente novo vai achar que terminou: ${faltando.join(", ")}`);
});

test("nenhum VALOR do .env.example aponta para o projeto orfao", () => {
  // `ogmypcbaqcamguqbhxjo` e o projeto que o HANDOFF §3.3 manda apagar.
  // Apontar para ele grava dado num banco que ninguem olha — e o pior tipo de
  // erro de configuracao, porque tudo parece funcionar.
  //
  // So os VALORES sao conferidos: o arquivo CITA o id num aviso, de proposito,
  // e proibir a citacao apagaria justamente o alerta que evita o erro.
  const valores = [...EXEMPLO.matchAll(/^[A-Z][A-Z_0-9]*=(.*)$/gm)].map((m) => m[1]);
  const suspeitos = valores.filter((v) => v.includes("ogmypcbaqcamguqbhxjo"));
  assert.deepEqual(suspeitos, [],
    "o .env.example aponta para o projeto Supabase orfao (HANDOFF §3.3)");
});

test("MKT_SCHEMA vem preenchido, e nao vazio", () => {
  // O default do codigo e `mkt`, e neste projeto `mkt` nao e nosso. Uma linha
  // `MKT_SCHEMA=` vazia seria pior que ausente: parece configurada.
  assert.match(EXEMPLO, /^MKT_SCHEMA=mkt_v2$/m,
    "MKT_SCHEMA precisa vir com mkt_v2: vazio cai no default `mkt`, que nao e nosso");
});
