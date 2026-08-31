/**
 * GET /api/health — o deploy subiu, e subiu CERTO?
 *
 * ── Por que esta rota existe ───────────────────────────────────────────────
 *
 * "Está no ar" e "está certo" são perguntas diferentes, e só a primeira tem
 * resposta óbvia. Um deploy verde pode estar servindo:
 *
 *   - a branch errada — aconteceu duas vezes com este repositório, porque a
 *     branch default do `mkt_v2` não é a que carrega o produto atual. O
 *     resultado é um sistema que funciona e está seis migrations atrás;
 *   - o schema errado — `MKT_SCHEMA` vazio cai no default `mkt`, que neste
 *     projeto não é nosso;
 *   - sem as migrations aplicadas — as telas abrem, e o agente recusa tudo;
 *   - sem `ANTHROPIC_API_KEY` — tudo funciona menos o agente, que é o produto.
 *
 * Nenhuma dessas aparece na primeira olhada. Todas aparecem aqui.
 *
 * ── A regra que torna esta rota segura de deixar aberta ────────────────────
 *
 * NUNCA sai um VALOR de variável de ambiente. Só sai se ela está definida.
 * `apps/web/test/health.test.mjs` lê este arquivo e falha se alguém escrever
 * `process.env.X` fora de um `Boolean(...)` — porque a versão perigosa desta
 * rota é a que "só mostra o começo da chave para ajudar a depurar".
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Está definida? Nunca o que vale. */
const tem = (nome: string) => Boolean(process.env[nome]);

/** As que, faltando, quebram alguma coisa — e o que exatamente quebra. */
const OBRIGATORIAS: Array<[string, string]> = [
  ["DATABASE_URL", "nenhuma tela e nenhuma rota funciona"],
  ["SUPABASE_JWT_SECRET", "ninguem consegue entrar"],
  ["SUPABASE_URL", "o login nao sai do lugar"],
  ["SUPABASE_ANON_KEY", "o login nao sai do lugar"],
  ["ANTHROPIC_API_KEY", "tudo funciona menos o agente"],
];

export async function GET() {
  const schema = process.env.MKT_SCHEMA || "mkt";
  const faltando = OBRIGATORIAS.filter(([n]) => !tem(n));

  // A branch e o commit vem da Vercel. Sao a resposta direta para "eu deployei
  // o que eu acho que deployei?" — a pergunta que ninguem pensa em fazer.
  const versao = {
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 8) || null,
    ambiente: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
  };

  let banco: Record<string, unknown> = { alcancavel: false };
  if (tem("DATABASE_URL")) {
    try {
      // O nome do schema nao pode vir de fora, entao ele e validado antes de
      // entrar na consulta — e nao existe placeholder para identificador.
      if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("schema invalido");
      const { rows } = await pool.query(
        `select count(*)::int as n, coalesce(max(name), '') as ultima
           from ${schema}.schema_migrations`);
      banco = {
        alcancavel: true,
        schema,
        migrations_aplicadas: rows[0].n,
        ultima_migration: rows[0].ultima || null,
      };
    } catch (e) {
      // A mensagem do Postgres pode conter o host. Sai o codigo, nao o texto.
      banco = { alcancavel: false, schema, erro: (e as { code?: string }).code ?? "DESCONHECIDO" };
    }
  }

  const checks = {
    variaveis: faltando.length === 0,
    banco: banco.alcancavel === true,
    migrations: typeof banco.migrations_aplicadas === "number" && banco.migrations_aplicadas > 0,
    agente: tem("ANTHROPIC_API_KEY"),
    publicacao_falsa: (process.env.META_ADAPTER ?? "fake") === "fake",
  };
  const ok = checks.variaveis && checks.banco && checks.migrations;

  return NextResponse.json({
    ok,
    versao,
    checks,
    banco,
    // O que falta, e o que isso custa. Nome da variavel, nunca o valor.
    faltando: faltando.map(([nome, custo]) => ({ nome, custo })),
  }, { status: ok ? 200 : 503 });
}
