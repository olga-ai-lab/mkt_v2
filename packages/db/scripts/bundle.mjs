#!/usr/bin/env node
/**
 * Gera um .sql unico com todas as migrations, ja apontadas para um schema.
 * Serve para aplicar via SQL Editor do Supabase, sem CLI e sem senha de banco.
 *
 *   MKT_SCHEMA=mkt_v2 node packages/db/scripts/bundle.mjs
 *
 * MKT_SCHEMA nao tem default: ver o comentario longo abaixo.
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { retarget } from "./migrate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "migrations");
// Destino sobrescrevivel. Serve para gerar um bundle avulso sem sujar o dist/
// versionado — e, principalmente, para o teste da trava poder EXECUTAR este
// script sem que uma trava quebrada escreva o arquivo perigoso no repositorio.
// Um teste que, ao falhar, produz exatamente o artefato que ele existe para
// impedir e um teste que piora o que estava tentando proteger.
const OUT_DIR = process.env.MKT_BUNDLE_OUT || join(HERE, "..", "dist");

/**
 * MKT_SCHEMA e OBRIGATORIO aqui — nao ha default, e isso e deliberado.
 *
 * O runtime pode ter default: la o schema e so o namespace das consultas, e
 * errar da um erro de tabela inexistente. Aqui nao. O que sai deste script e um
 * arquivo que alguem COLA NO SQL EDITOR de producao, com "drop schema X
 * cascade" escrito no cabecalho como instrucao de reversao.
 *
 * No projeto Supabase da Olga, os schemas `mkt` e `rh` tem dados que NAO sao
 * nossos (docs/HANDOFF.md §3.1). Um default de "mkt" gera, sem aviso, um
 * arquivo que cria 28 tabelas no schema errado e ensina a apagar o schema dela
 * para reverter. Ja aconteceu nesta sessao, por um `npm run db:bundle` sem
 * variavel.
 *
 * Um default conveniente que aponta para o lugar proibido nao e conveniencia:
 * e uma arma carregada com a trava desligada.
 */
const SCHEMA = process.env.MKT_SCHEMA;
if (!SCHEMA) {
  console.error(
    "MKT_SCHEMA e obrigatorio. Este script gera um arquivo para colar no SQL\n" +
    "Editor de producao — nao ha default seguro.\n\n" +
    "  MKT_SCHEMA=mkt_v2 node packages/db/scripts/bundle.mjs\n\n" +
    "O alvo deste projeto e mkt_v2. Ver docs/HANDOFF.md §3.1 antes de usar outro.");
  process.exit(1);
}
if (!/^[a-z][a-z0-9_]*$/.test(SCHEMA)) {
  console.error(`MKT_SCHEMA invalido: "${SCHEMA}"`);
  process.exit(1);
}

// MKT_ONLY filtra por prefixo, para gerar bundle incremental de quem ja aplicou
// as anteriores. Aceita lista: MKT_ONLY=0007  ou  MKT_ONLY=0001,0002,0003
const ONLY = process.env.MKT_ONLY?.split(",").map((s) => s.trim()).filter(Boolean);
const files = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => !ONLY || ONLY.some((p) => f.startsWith(p)))
  .sort();
if (files.length === 0) { console.error(`nenhuma migration casa com MKT_ONLY=${ONLY?.join(",")}`); process.exit(1); }

const header = `-- =====================================================================
-- Olga Marketing OS — schema ${SCHEMA}
--
-- Bundle das ${files.length} migrations, geradas a partir de packages/db/migrations/.
-- NAO EDITAR: regenere com  MKT_SCHEMA=${SCHEMA} node packages/db/scripts/bundle.mjs
--
-- Aplicar: cole no SQL Editor do Supabase e execute uma vez.
-- Tudo roda numa transacao: ou entra inteiro, ou nao entra nada.
--
-- Reverter:  drop schema ${SCHEMA} cascade;
-- =====================================================================

begin;

`;

const body = files
  .map((f) => `-- ─── ${f} ${"─".repeat(Math.max(0, 60 - f.length))}\n\n${retarget(readFileSync(join(MIGRATIONS, f), "utf8"), SCHEMA)}`)
  .join("\n\n");

const footer = `

-- Controle de versao das migrations, para o runner reconhecer o que ja rodou.
create table if not exists ${SCHEMA}.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
-- Nenhuma tabela do schema fica alcancavel pela anon key, nem o ledger do runner.
alter table ${SCHEMA}.schema_migrations enable row level security;
insert into ${SCHEMA}.schema_migrations (name) values
${files.map((f) => `  ('${f}')`).join(",\n")}
on conflict (name) do nothing;

commit;

-- Conferencia rapida apos aplicar:
--   select count(*) from information_schema.tables where table_schema = '${SCHEMA}';
--   select capability_id, status from ${SCHEMA}.capability_registry order by 1;
`;

mkdirSync(OUT_DIR, { recursive: true });
const path = join(OUT_DIR, ONLY ? `${SCHEMA}_${ONLY.join("-")}.sql` : `${SCHEMA}.sql`);
writeFileSync(path, header + body + footer);
console.log(`ok  ${path.replace(process.cwd() + "/", "")}  (${files.length} migration(s), schema ${SCHEMA})`);
