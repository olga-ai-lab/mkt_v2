#!/usr/bin/env node
/**
 * Aplica as migracoes em ordem, uma transacao por arquivo, e registra o que ja
 * rodou em <schema>.schema_migrations.
 *
 *   node packages/db/scripts/migrate.mjs
 *   DATABASE_URL=... node packages/db/scripts/migrate.mjs
 *   MKT_SCHEMA=mkt_v2 node packages/db/scripts/migrate.mjs
 *
 * Sobre o parametro de schema
 * ---------------------------
 * Os arquivos .sql sao a fonte unica e usam `mkt.` literalmente, para que
 * continuem executaveis direto no psql sem pre-processamento. Quando MKT_SCHEMA
 * aponta para outro nome, este runner reescreve as referencias antes de aplicar.
 *
 * Isso e um rename de namespace, nao um template: a substituicao so atinge o
 * token `mkt` quando ele aparece como qualificador de schema (`mkt.algo`) ou na
 * criacao do proprio schema. Nomes que contenham "mkt" como parte de outra
 * palavra ficam intactos. Um schema alternativo e uma copia estrutural completa
 * e independente — enums, funcoes, policies e triggers proprios.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "migrations");

const SCHEMA = process.env.MKT_SCHEMA || "mkt";
if (!/^[a-z][a-z0-9_]*$/.test(SCHEMA)) {
  console.error(`MKT_SCHEMA invalido: "${SCHEMA}". Use apenas minusculas, digitos e underscore.`);
  process.exit(1);
}

const url = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;

/** Reescreve o namespace do SQL. Devolve o texto inalterado quando SCHEMA === 'mkt'. */
export function retarget(sql, schema) {
  if (schema === "mkt") return sql;
  return sql
    .replace(/\bcreate schema if not exists mkt\b/g, `create schema if not exists ${schema}`)
    .replace(/\bmkt\.(?=[a-z_])/g, `${schema}.`)
    .replace(/\bsearch_path = mkt\b/g, `search_path = ${schema}`)
    .replace(/'mkt\.(?=[a-z_])/g, `'${schema}.`);
}

// Efeito colateral so quando executado direto. Importar o modulo e seguro.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (!url) {
    console.error("defina DATABASE_URL (ou TEST_DATABASE_URL)");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(`create schema if not exists ${SCHEMA}`);
  await client.query(`
    create table if not exists ${SCHEMA}.schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )`);
  // Mesma regra que vale para as tabelas das migrations vale para o ledger do
  // proprio runner: nenhuma tabela do schema fica alcancavel pela anon key.
  // Sem policy, so quem tem BYPASSRLS (service_role) chega aqui. Idempotente.
  await client.query(`alter table ${SCHEMA}.schema_migrations enable row level security`);

  const done = new Set(
    (await client.query(`select name from ${SCHEMA}.schema_migrations`)).rows.map((r) => r.name),
  );
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

  if (SCHEMA !== "mkt") console.log(`schema alvo: ${SCHEMA}\n`);

  let applied = 0;
  for (const f of files) {
    if (done.has(f)) { console.log(`skip  ${f}`); continue; }
    const sql = retarget(readFileSync(join(MIGRATIONS, f), "utf8"), SCHEMA);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(`insert into ${SCHEMA}.schema_migrations (name) values ($1)`, [f]);
      await client.query("commit");
      console.log(`ok    ${f}`);
      applied++;
    } catch (e) {
      await client.query("rollback");
      console.error(`FALHOU ${f}\n${e.message}`);
      process.exit(1);
    }
  }
  await client.end();
  console.log(`\n${applied} migracao(oes) aplicada(s) em ${SCHEMA}, ${files.length} no total.`);
}
