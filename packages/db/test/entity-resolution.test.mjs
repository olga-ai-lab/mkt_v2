/**
 * Resolução de entidade contra Postgres real.
 *
 * O teste unitário (packages/runtime/test/entity-resolver.test.mjs) prova as
 * decisões com uma porta de mentira. Este prova o que só o banco pode provar:
 * que `mkt.norm` normaliza o que diz normalizar, que o índice único recusa um
 * apelido ambíguo em vez de deixar a aplicação escolher, e que a consulta não
 * enxerga a organização do vizinho.
 *
 * Mestra §7.2 (camada de entidades) e §13 ("Entity Resolution usa
 * registry/aliases/IDs e nao fuzzy matching irrestrito").
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createEntityResolver } from "@olga/runtime/entity-resolver";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports, resolver;

const limpar = () =>
  db.query(`delete from mkt.organizations where slug in ('ent-test','ent-vizinho')`);

const tenant = () => ({ org_id: ids.org, workspace_id: ids.ws });
const resolverMarca = (raw, canonical_id = null) => resolver.resolve({
  trace_id: "tr_ent", tenant: tenant(),
  intent: { intent: "EXPLAIN", entities: [{ type: "brand", canonical_id, raw }] } });

before(async () => {
  await db.connect();
  ports = createPostgresPorts(db);
  resolver = createEntityResolver({ entities: ports.entities });
});

beforeEach(async () => {
  await limpar();
  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Ent','ent-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name, website_url)
    select w.org_id, w.id, 'Corretora Ipê Seguros', 'https://ipe.test' from w
    returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;

  const outra = await db.query(
    `insert into mkt.brands (org_id, workspace_id, name, website_url)
     values ($1,$2,'Seguradora Beta','https://beta.test') returning id`, [ids.org, ids.ws]);
  ids.outra = outra.rows[0].id;

  const c = await db.query(
    `insert into mkt.contents (org_id, workspace_id, brand_id, title)
     values ($1,$2,$3,'Prevenção de Enchente') returning id`, [ids.org, ids.ws, ids.brand]);
  ids.content = c.rows[0].id;
  for (const v of [1, 2]) {
    const cv = await db.query(
      `insert into mkt.content_versions (org_id, content_id, version, master_body, state)
       values ($1,$2,$3,'Texto.','DRAFT') returning id`, [ids.org, ids.content, v]);
    ids[`cv${v}`] = cv.rows[0].id;
  }
});

after(async () => { await limpar(); await db.end(); });

// ── mkt.norm: a regra, e não uma conveniência ───────────────────────────────

test("norm iguala caixa, acento e espaco — e nada alem disso", async () => {
  const { rows } = await db.query(`
    select mkt.norm('  Corretora   IPÊ ') as a,
           mkt.norm('corretora ipe')      as b,
           mkt.norm('Corretora-Ipe')      as c`);
  assert.equal(rows[0].a, rows[0].b, "acento, caixa e espaco sao a mesma palavra escrita diferente");
  assert.notEqual(rows[0].c, rows[0].b, "hifen nao e espaco: normalizar nao pode virar adivinhar");
});

// ── Os três métodos ─────────────────────────────────────────────────────────

test("o nome cadastrado resolve, digitado sem acento", async () => {
  const r = await resolverMarca("corretora ipe seguros");
  assert.equal(r.ok, true, JSON.stringify(r.resolution.unresolved));
  assert.equal(r.resolution.resolved[0].canonical_id, ids.brand);
  assert.equal(r.resolution.resolved[0].method, "unique_natural_key");
});

test("apelido registrado resolve", async () => {
  await ports.entities.addAlias({ org_id: ids.org, entity_type: "brand",
    canonical_id: ids.brand, alias: "CI", actor_id: "u1" });

  const r = await resolverMarca("ci");
  assert.equal(r.resolution.resolved[0].canonical_id, ids.brand);
  assert.equal(r.resolution.resolved[0].method, "alias");
});

test("o id como texto resolve por exact_id", async () => {
  const r = await resolverMarca(ids.brand);
  assert.equal(r.resolution.resolved[0].method, "exact_id");
});

test("titulo de conteudo resolve para a versao mais recente, e nao vira ambiguidade", async () => {
  // Um conteúdo tem várias versões. Sem o `distinct on`, todo título com
  // histórico seria ambíguo por construção — e a pergunta "qual delas?" não
  // teria resposta que alguém pudesse dar.
  const r = await resolver.resolve({
    trace_id: "tr_ent", tenant: tenant(),
    intent: { intent: "EXPLAIN",
              entities: [{ type: "content_version", canonical_id: null,
                           raw: "prevencao de enchente" }] } });
  assert.equal(r.ok, true, JSON.stringify(r.resolution.unresolved));
  assert.equal(r.resolution.resolved[0].canonical_id, ids.cv2);
});

test("canal resolve contra o enum, que e o cadastro dele", async () => {
  const r = await resolver.resolve({
    trace_id: "tr_ent", tenant: tenant(),
    intent: { intent: "PUBLISH_CONTENT",
              entities: [{ type: "channel", canonical_id: null, raw: "instagram" }] } });
  assert.equal(r.resolution.resolved[0].canonical_id, "INSTAGRAM");

  const inventado = await resolver.resolve({
    trace_id: "tr_ent", tenant: tenant(),
    intent: { intent: "PUBLISH_CONTENT",
              entities: [{ type: "channel", canonical_id: null, raw: "tiktok" }] } });
  assert.equal(inventado.resolution.unresolved[0].reason_code, "NORMALIZATION_FAILED");
});

// ── O índice único é a regra ────────────────────────────────────────────────

test("o mesmo apelido para duas marcas nao entra", async () => {
  // Sem esta linha, a resolução teria de escolher entre dois candidatos — e
  // escolher é o que o §13 proíbe. A garantia mora no índice, não na aplicação.
  await ports.entities.addAlias({ org_id: ids.org, entity_type: "brand",
    canonical_id: ids.brand, alias: "a corretora" });

  const r = await ports.entities.addAlias({ org_id: ids.org, entity_type: "brand",
    canonical_id: ids.outra, alias: "A CORRETORA" });

  assert.equal(r.ok, false);
  assert.equal(r.reason, "ALIAS_TAKEN");
  assert.equal(r.canonical_id, ids.brand, "quem chama precisa saber para onde o apelido ja aponta");
});

test("registrar o mesmo apelido para a mesma marca duas vezes e idempotente", async () => {
  const a = await ports.entities.addAlias({ org_id: ids.org, entity_type: "brand",
    canonical_id: ids.brand, alias: "CI" });
  const b = await ports.entities.addAlias({ org_id: ids.org, entity_type: "brand",
    canonical_id: ids.brand, alias: "  ci  " });

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.ja_existia, true);
  assert.equal((await ports.entities.aliasesOf(ids.org, "brand", ids.brand)).length, 1);
});

test("homonimos viram pergunta, e o banco nao desempata por conta propria", async () => {
  await db.query(
    `insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'Seguros Duplo')`,
    [ids.org, ids.ws]);
  await db.query(
    `insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'seguros  duplo')`,
    [ids.org, ids.ws]);

  const r = await resolverMarca("Seguros Duplo");
  assert.equal(r.ok, false);
  assert.equal(r.resolution.unresolved[0].reason_code, "AMBIGUOUS_ENTITY");
});

// ── Tenant ──────────────────────────────────────────────────────────────────

test("a marca do vizinho nao resolve, nem por nome nem por id", async () => {
  const v = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Viz','ent-vizinho') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'W' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name)
    select w.org_id, w.id, 'Marca do Vizinho' from w returning id`);

  const porNome = await resolverMarca("Marca do Vizinho");
  assert.equal(porNome.resolution.unresolved[0].reason_code, "NORMALIZATION_FAILED");

  // Com o id na mão. É o caso perigoso: um id vazado por qualquer via não pode
  // virar alvo, e "não achei" é a resposta certa — dizer "isso é de outro
  // tenant" confirmaria que ele existe.
  const porId = await resolverMarca("a marca", v.rows[0].id);
  assert.equal(porId.resolution.unresolved[0].reason_code, "NORMALIZATION_FAILED");
});

test("apelido de uma organizacao nao resolve na outra", async () => {
  await ports.entities.addAlias({ org_id: ids.org, entity_type: "brand",
    canonical_id: ids.brand, alias: "CI" });
  const outra = await db.query(
    `insert into mkt.organizations (name, slug) values ('Viz','ent-vizinho') returning id`);

  assert.equal(await ports.entities.byAlias(outra.rows[0].id, "brand", "CI"), null);
});

// ── O que não vira consulta ─────────────────────────────────────────────────

test("texto que nao e uuid nao vira `where id = $1`", async () => {
  // Sem a guarda, o Postgres devolveria erro de tipo — que sobe como 500 em
  // vez de "não encontrei", e transforma um nome digitado errado em incidente.
  assert.equal(await ports.entities.byId(ids.org, "brand", "a marca"), null);
  assert.equal(await ports.entities.byId(ids.org, "content_version", "o post"), null);
  assert.deepEqual(await ports.entities.byNaturalKey(ids.org, "brand", "   "), []);
});
