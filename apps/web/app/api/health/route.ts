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

/**
 * Um objeto por onda de migration, e o que a falta dele custa.
 *
 * ── Por que NAO se conta `schema_migrations` ───────────────────────────────
 *
 * Era o que esta rota fazia, e estava errado. Aquela tabela e escrita pelo
 * `migrate.mjs`; quem aplica colando o bundle no SQL Editor do Supabase — que
 * e como este projeto aplicou tudo ate hoje — nao a cria. Contra o banco de
 * verdade a consulta devolvia 42P01, e a rota diria "banco inalcancavel" com o
 * banco inteiro no ar.
 *
 * Um health check que so funciona no caminho de instalacao que ninguem usa e
 * pior que nenhum: ele reprova producao e aprova a maquina de quem escreveu.
 *
 * Entao a pergunta mudou de "quantas migrations o ledger registra" para "os
 * objetos que ESTE codigo precisa existem?". Essa vale nos dois caminhos, e e
 * a pergunta que de fato importa.
 */
const MARCOS: Array<{ migration: string; teste: (s: string) => string; custo: string }> = [
  { migration: "0007",
    teste: (s) => `to_regclass('${s}.model_routing') is not null`,
    custo: "o Model Gateway recusa todo run com BUDGET_NOT_CONFIGURED" },

  // 0010 e 0011 nao criam objeto nenhum: sao DADO — uma capability apontada
  // para o adapter certo, uma capability nova, uma policy. Procurar tabela
  // aqui daria "aplicada" para um banco onde nada foi aplicado.
  { migration: "0010",
    teste: (s) => `exists (select 1 from ${s}.capability_registry
                            where capability_id = 'brand.extract_from_url'
                              and provider_adapter = 'brand_extract')`,
    custo: "brand.extract_from_url aponta para o adapter errado; o onboarding de marca nao funciona" },
  { migration: "0011",
    teste: (s) => `exists (select 1 from ${s}.capability_registry
                            where capability_id = 'quality.ai_review' and status = 'ACTIVE')`,
    custo: "nada move DRAFT para AI_REVIEW; o conteudo trava antes da revisao" },

  { migration: "0012",
    teste: (s) => `to_regclass('${s}.source_contracts') is not null`,
    custo: "o retrieval marca TODA fatia como vencida (fail-closed)" },
  { migration: "0013",
    teste: (s) => `to_regclass('${s}.agent_personas') is not null`,
    custo: "persona nao versionada; o trace nao reproduz um incidente" },
  { migration: "0014",
    teste: (s) => `exists (select 1 from information_schema.columns
                            where table_schema = '${s}' and table_name = 'rule_policies'
                              and column_name = 'created_by')`,
    custo: "sem kill switch: conter um incidente exigiria uma migration na hora" },
  { migration: "0015",
    teste: (s) => `to_regclass('${s}.entity_aliases') is not null`,
    custo: "nenhum nome de marca resolve para id" },
  { migration: "0016",
    teste: (s) => `exists (select 1 from information_schema.columns
                            where table_schema = '${s}' and table_name = 'agent_runs'
                              and column_name = 'injection_signals')`,
    custo: "a linha Safety do trace nao e gravada" },
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
  let faltamMigrations: typeof MARCOS = [];
  if (tem("DATABASE_URL")) {
    try {
      // O nome do schema nao pode vir de fora, entao ele e validado antes de
      // entrar na consulta — e nao existe placeholder para identificador.
      if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("schema invalido");

      // O schema entra por interpolacao porque nao existe placeholder para
      // identificador em SQL. A validacao acima e a unica coisa entre ele e
      // uma injecao — e nenhum outro valor daqui vem de fora.
      const { rows } = await pool.query(
        `select ${MARCOS.map((m, i) => `(${m.teste(schema)}) as m${i}`).join(", ")}`);

      faltamMigrations = MARCOS.filter((_, i) => rows[0][`m${i}`] !== true);
      banco = {
        alcancavel: true,
        schema,
        migrations_ok: faltamMigrations.length === 0,
        faltam_migrations: faltamMigrations.map((m) => ({ migration: m.migration, custo: m.custo })),
      };
    } catch (e) {
      // A mensagem do Postgres pode conter o host. Sai o codigo, nao o texto.
      banco = { alcancavel: false, schema, erro: (e as { code?: string }).code ?? "DESCONHECIDO" };
    }
  }

  const checks = {
    variaveis: faltando.length === 0,
    banco: banco.alcancavel === true,
    migrations: banco.migrations_ok === true,
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
