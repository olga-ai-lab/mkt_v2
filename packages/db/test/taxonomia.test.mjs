/**
 * A camada canonica do mercado — o que ela e antes de alguem curar.
 *
 * O risco desta tabela nao e ficar vazia: e alguem tratar a carga proposta
 * como verdade. Ela foi escrita nesta sessao, a partir do que se sabe do
 * mercado, e nao passou por nenhum especialista da Olga. Enquanto isso nao
 * acontecer, ela precisa nao decidir nada — e e isso que estes testes
 * protegem.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
let ports;

before(async () => {
  await db.connect();
  ports = createPostgresPorts(db, { schema: "mkt" });
});

after(async () => {
  await db.query(`delete from mkt.taxonomy_terms where term like 'termo-de-teste%'`);
  await db.query(`delete from mkt.taxonomy_products where product_code like 'TESTE_%'`);
  await db.end();
});

test("nenhuma linha semeada nasce ACTIVE", async () => {
  // Uma taxonomia errada promovida contamina todo julgamento posterior, e
  // ninguem percebe a origem. Por isso a carga e proposta, nao verdade.
  const { rows } = await db.query(`
    select 'products' t, count(*)::int n from mkt.taxonomy_products where status = 'ACTIVE'
    union all select 'audiences', count(*)::int from mkt.taxonomy_audiences where status = 'ACTIVE'
    union all select 'content_types', count(*)::int from mkt.taxonomy_content_types where status = 'ACTIVE'
    union all select 'terms', count(*)::int from mkt.taxonomy_terms where status = 'ACTIVE'`);

  for (const r of rows) {
    assert.equal(r.n, 0, `${r.t}: carga semeada nao pode nascer curada`);
  }
});

test("a taxonomia nao decide nada enquanto ninguem curou", async () => {
  // O port le so ACTIVE. Vazio aqui significa "ainda nao decide", e nao
  // "o mercado nao tem vedacao" — a diferenca esta em pendingCuration().
  assert.deepEqual(await ports.taxonomy.activeProducts(), []);
  assert.deepEqual(await ports.taxonomy.forbiddenTerms(["RESIDENCIAL"]), []);

  const pendentes = await ports.taxonomy.pendingCuration();
  assert.ok(pendentes.products > 20, "os produtos propostos precisam estar la, esperando");
  assert.ok(pendentes.terms > 10, "os termos vedados propostos precisam estar la, esperando");
});

test("publico-alvo e tipo de conteudo sobem vazios, de proposito", async () => {
  // Nao ha fonte publica de onde partir. Propor seria inventar a estrutura do
  // mercado a partir do que o modelo acha, e lacuna preenchida com palpite
  // vira fato falso que todo mundo passa a citar.
  const a = await db.query(`select count(*)::int n from mkt.taxonomy_audiences`);
  const c = await db.query(`select count(*)::int n from mkt.taxonomy_content_types`);
  assert.equal(a.rows[0].n, 0);
  assert.equal(c.rows[0].n, 0);
});

test("promover sem dizer quem curou e quando e recusado pelo banco", async () => {
  await db.query(
    `insert into mkt.taxonomy_products (product_code, label) values ('TESTE_RAMO','Teste')`);

  await assert.rejects(
    () => db.query(`update mkt.taxonomy_products set status = 'ACTIVE' where product_code = 'TESTE_RAMO'`),
    /taxonomy_product_active_curado/,
    "curado e um fato com dono e data; sem os dois nao ha o que auditar");

  await db.query(
    `update mkt.taxonomy_products
        set status = 'ACTIVE', curated_at = now(), curated_by = 'teste'
      where product_code = 'TESTE_RAMO'`);

  const ativos = await ports.taxonomy.activeProducts();
  assert.ok(ativos.some((p) => p.product_code === "TESTE_RAMO"),
    "depois de curado, o produto passa a ser lido");
});

test("termo com escopo de ramo alcanca os produtos daquele ramo", async () => {
  // O termo de saude vale para SAUDE_PME porque o produto aponta para o ramo.
  // Sem isso, cada vedacao teria de ser repetida produto a produto — e uma
  // lista repetida diverge no primeiro dia em que alguem esquece uma linha.
  await db.query(`
    insert into mkt.taxonomy_terms (term, kind, scope_product, rationale, status, curated_at, curated_by)
    values ('termo-de-teste-saude', 'FORBIDDEN', 'SAUDE', 'teste', 'ACTIVE', now(), 'teste')`);

  const paraSaude = await ports.taxonomy.forbiddenTerms(["SAUDE_PME"]);
  assert.ok(paraSaude.some((t) => t.term === "termo-de-teste-saude"));

  const paraAuto = await ports.taxonomy.forbiddenTerms(["AUTO_INDIVIDUAL"]);
  assert.ok(!paraAuto.some((t) => t.term === "termo-de-teste-saude"),
    "vedacao de saude nao pode aparecer em conteudo de auto");
});

test("termo de mercado vale para qualquer produto, inclusive nenhum", async () => {
  await db.query(`
    insert into mkt.taxonomy_terms (term, kind, rationale, status, curated_at, curated_by)
    values ('termo-de-teste-global', 'FORBIDDEN', 'teste', 'ACTIVE', now(), 'teste')`);

  for (const escopo of [[], ["AUTO_INDIVIDUAL"], ["SAUDE_PME", "RESIDENCIAL"]]) {
    const t = await ports.taxonomy.forbiddenTerms(escopo);
    assert.ok(t.some((x) => x.term === "termo-de-teste-global"),
      `vedacao de mercado precisa valer tambem para ${JSON.stringify(escopo)}`);
  }
});

test("o mesmo termo nao entra duas vezes no mesmo escopo", async () => {
  // Duas linhas para a mesma vedacao viram duas recusas com textos diferentes,
  // e quem le nao sabe qual seguir.
  await db.query(
    `insert into mkt.taxonomy_terms (term, kind, rationale) values ('termo-de-teste-dup','FORBIDDEN','teste')`);
  await assert.rejects(
    () => db.query(
      `insert into mkt.taxonomy_terms (term, kind, rationale) values ('Termo-De-Teste-Dup','FORBIDDEN','outro')`),
    /taxonomy_term_unico/,
    "a unicidade ignora maiuscula: e o mesmo termo");
});

test("toda vedacao diz por que, para a recusa ser acionavel", async () => {
  // "termo proibido" manda a pessoa adivinhar o que escrever no lugar.
  const { rows } = await db.query(
    `select term from mkt.taxonomy_terms where rationale is null or btrim(rationale) = ''`);
  assert.deepEqual(rows, []);
});

test("as quatro tabelas da taxonomia tem RLS ligada", async () => {
  // Sem org_id nao e desculpa: o dado e de mercado, a leitura e liberada, e a
  // escrita nao tem policy nenhuma — so migration e service_role escrevem.
  const { rows } = await db.query(`
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'mkt' and c.relname like 'taxonomy_%' and c.relkind = 'r'
     order by c.relname`);

  assert.equal(rows.length, 4);
  for (const r of rows) {
    assert.ok(r.relrowsecurity && r.relforcerowsecurity, `${r.relname} sem RLS forcada`);
  }
});
