/**
 * Contratos de fonte, contra Postgres real (Mestra §7.5).
 *
 * Duas perguntas que só têm resposta com banco:
 *
 *   1. o catálogo aplicado é o que o dublê dos testes sem banco acredita?
 *   2. o retrieval, ligado nas portas de verdade, envelhece cada fonte pelo
 *      prazo dela?
 *
 * A primeira é a que impede o pior caso deste desenho: alguém muda um prazo na
 * migration, o dublê do teste unitário continua com o antigo, e as duas suítes
 * ficam verdes cada uma com a sua verdade.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createRetrieval } from "@olga/runtime/retrieval";
import { CONTRATOS_DE_FONTE } from "../../runtime/test/fixtures/source-contracts.mjs";
import { enumValues } from "@olga/contracts";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports;

const limpar = () => db.query(`delete from mkt.organizations where slug = 'fonte-test'`);
const diasAtras = (n) => new Date(Date.now() - n * 24 * 3600 * 1000).toISOString();

before(async () => {
  await db.connect();
  await limpar();
  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Fonte','fonte-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name, website_url)
    select w.org_id, w.id, 'Corretora', 'https://c.test' from w
    returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;
  ports = createPostgresPorts(db);
});

after(async () => { await limpar(); await db.end(); });

// ── O catálogo aplicado é o que o código acredita ───────────────────────────

test("toda fonte do enum tem contrato ACTIVE", async () => {
  // Fonte sem contrato cairia num default implícito no código — que é
  // exatamente o que a 0012 existe para tirar de lá.
  const { rows } = await db.query(
    `select source_kind from mkt.source_contracts where status = 'ACTIVE'`);
  assert.deepEqual(
    rows.map((r) => r.source_kind).sort(),
    [...enumValues("olga://enums/source-kind")].sort());
});

test("o catalogo do banco bate com o duble dos testes sem banco", async () => {
  const contratos = await ports.knowledge.sourceContracts();
  for (const [kind, esperado] of Object.entries(CONTRATOS_DE_FONTE)) {
    const real = contratos[kind];
    assert.ok(real, `${kind} sem contrato no banco`);
    for (const campo of ["temporal_authority", "max_age_days", "default_quality", "carries_pii"]) {
      assert.deepEqual(real[campo], esperado[campo],
        `${kind}.${campo}: a migration diz ${real[campo]} e o duble diz ${esperado[campo]}`);
    }
  }
});

test("uma so ACTIVE por fonte, e quem garante e o indice", async () => {
  await assert.rejects(
    () => db.query(
      `insert into mkt.source_contracts
         (source_kind, version, status, temporal_authority, max_age_days, default_quality, owner)
       values ('BRAND_BRAIN', 2, 'ACTIVE', 'created_at', 10, 'LOW', 'teste')`),
    /source_contracts_one_active/);
});

test("prazo nulo e permitido; prazo zero ou negativo nao", async () => {
  // Nulo é a afirmação "não vence". Zero seria "vence sempre", que não é uma
  // política de freshness — é um jeito de desligar a fonte sem dizer.
  await assert.rejects(
    () => db.query(
      `insert into mkt.source_contracts
         (source_kind, version, status, temporal_authority, max_age_days, default_quality, owner)
       values ('BRAND_BRAIN', 3, 'CANDIDATE', 'created_at', 0, 'LOW', 'teste')`),
    /max_age_days/);
});

test("a tabela de catalogo nao fica sem RLS", async () => {
  // Sem org_id ela não passa pelo enable_org_rls(), e foi por essa brecha que
  // processed_events escapou na 0005.
  const { rows } = await db.query(
    `select relrowsecurity from pg_class where oid = 'mkt.source_contracts'::regclass`);
  assert.equal(rows[0].relrowsecurity, true);
});

// ── O retrieval, ligado nas portas de verdade ───────────────────────────────

test("Brand Brain de 200 dias vence; o de 100 nao", async () => {
  const retrieval = createRetrieval({ knowledge: ports.knowledge });
  const intent = { intent: "EXPLAIN", entities: [{ type: "brand", canonical_id: ids.brand }] };

  const bb = await db.query(
    `insert into mkt.brand_brain_versions (org_id, brand_id, version, status, activated_at)
     values ($1,$2,1,'ACTIVE',$3) returning id`, [ids.org, ids.brand, diasAtras(200)]);

  let r = await retrieval.fetch({ trace_id: "t", tenant: { org_id: ids.org, workspace_id: ids.ws }, intent });
  assert.equal(r.stale, true);
  assert.deepEqual(r.vencidas.map((v) => v.source_kind), ["BRAND_BRAIN"]);

  await db.query(`update mkt.brand_brain_versions set activated_at = $2 where id = $1`,
    [bb.rows[0].id, diasAtras(100)]);

  r = await retrieval.fetch({ trace_id: "t", tenant: { org_id: ids.org, workspace_id: ids.ws }, intent });
  assert.equal(r.stale, false, "180 dias e o prazo do contrato, e 100 cabe nele");
});

test("o cadastro da marca nao vence, por mais antigo que seja", async () => {
  await db.query(`update mkt.brands set created_at = $2 where id = $1`, [ids.brand, diasAtras(3000)]);
  const r = await createRetrieval({ knowledge: ports.knowledge }).fetch({
    trace_id: "t", tenant: { org_id: ids.org, workspace_id: ids.ws },
    intent: { intent: "ONBOARD_BRAND", entities: [{ type: "brand", canonical_id: ids.brand }] },
  });
  assert.equal(r.stale, false);
  assert.equal(r.slices[0].evidence.quality, "HIGH", "a qualidade veio do contrato");
});
