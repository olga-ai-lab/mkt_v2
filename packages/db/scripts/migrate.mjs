#!/usr/bin/env node
/**
 * Aplica as migracoes em ordem, dentro de UMA transacao por arquivo,
 * e registra o que ja rodou em mkt.schema_migrations.
 *
 *   node packages/db/scripts/migrate.mjs                  # usa DATABASE_URL
 *   DATABASE_URL=... node packages/db/scripts/migrate.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "migrations");
const url = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
if (!url) {
  console.error("defina DATABASE_URL (ou TEST_DATABASE_URL)");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
await client.query(`create schema if not exists mkt`);
await client.query(`
  create table if not exists mkt.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);

const done = new Set((await client.query("select name from mkt.schema_migrations")).rows.map((r) => r.name));
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();

let applied = 0;
for (const f of files) {
  if (done.has(f)) { console.log(`skip  ${f}`); continue; }
  const sql = readFileSync(join(MIGRATIONS, f), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("insert into mkt.schema_migrations (name) values ($1)", [f]);
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
console.log(`\n${applied} migracao(oes) aplicada(s), ${files.length} no total.`);
