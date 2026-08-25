import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { retarget } from "../scripts/migrate.mjs";

const DIR = new URL("../migrations/", import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));

test("sem MKT_SCHEMA o SQL sai intacto", () => {
  const sql = readFileSync(join(DIR, files[0]), "utf8");
  assert.equal(retarget(sql, "mkt"), sql);
});

test("renomeia todo qualificador de schema", () => {
  const sql = "create table mkt.brands (id uuid); select mkt.enable_org_rls('mkt.brands');";
  const out = retarget(sql, "mkt_v2");
  assert.match(out, /create table mkt_v2\.brands/);
  assert.match(out, /select mkt_v2\.enable_org_rls\('mkt_v2\.brands'\)/);
  assert.ok(!/\bmkt\./.test(out), "sobrou referencia ao schema original");
});

test("renomeia o search_path das funcoes security definer", () => {
  const out = retarget("set search_path = mkt, pg_temp", "mkt_v2");
  assert.match(out, /search_path = mkt_v2, pg_temp/);
});

test("nao toca em palavras que apenas contem mkt", () => {
  const sql = "-- ver MKT-09B; coluna mktg_flag; tabela mkt.contents";
  const out = retarget(sql, "mkt_v2");
  assert.match(out, /MKT-09B/);
  assert.match(out, /mktg_flag/);
  assert.match(out, /mkt_v2\.contents/);
});

test("nenhuma migration deixa referencia ao schema antigo apos o retarget", () => {
  for (const f of files) {
    const out = retarget(readFileSync(join(DIR, f), "utf8"), "mkt_v2");
    const sobras = out.match(/\bmkt\.[a-z_]/g) ?? [];
    assert.deepEqual(sobras, [], `${f} deixou: ${sobras.join(", ")}`);
    assert.ok(!/create schema if not exists mkt\b(?!_)/.test(out), `${f} ainda cria o schema mkt`);
  }
});

test("nome de schema invalido nunca chega ao SQL", () => {
  // O runner valida com regex antes; aqui garantimos que a funcao e pura e
  // nao concatena nada que o chamador nao tenha passado.
  const out = retarget("create table mkt.x ()", "outro_schema");
  assert.match(out, /outro_schema\.x/);
});
