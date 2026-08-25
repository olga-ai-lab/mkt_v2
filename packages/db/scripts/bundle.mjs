#!/usr/bin/env node
/**
 * Gera um .sql unico com todas as migrations, ja apontadas para um schema.
 * Serve para aplicar via SQL Editor do Supabase, sem CLI e sem senha de banco.
 *
 *   MKT_SCHEMA=mkt_v2 node packages/db/scripts/bundle.mjs
 *   node packages/db/scripts/bundle.mjs > /tmp/mkt.sql
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { retarget } from "./migrate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "migrations");
const OUT_DIR = join(HERE, "..", "dist");

const SCHEMA = process.env.MKT_SCHEMA || "mkt";
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
