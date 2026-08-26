/**
 * Ativacao de Brand Brain, contra Postgres real.
 *
 * O que so aparece aqui: o unique index parcial `brand_brain_one_active`, que
 * e quem de fato garante uma versao ativa por marca. Um duble aceitaria duas.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createBrandActivationService, lacunasDe } from "@olga/runtime/brand-activation";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports, svc;

const limpar = () => db.query(`delete from mkt.organizations where slug = 'ativ-test'`);

const DONO = { id: "u-dono", role: "OWNER" };
const tenant = () => ({ org_id: ids.org, workspace_id: ids.ws });

/** Cria uma versao com o status pedido, sem passar pelo agente. */
async function versao({ status = "CANDIDATE", claims = ["Atende enchente"], proibicoes = [],
                        disclaimers = ["Consulte as condicoes gerais"], fontes = null } = {}) {
  const prox = await db.query(
    `select coalesce(max(version), 0) + 1 as v from mkt.brand_brain_versions
      where org_id = $1 and brand_id = $2`, [ids.org, ids.brand]);
  const { rows } = await db.query(
    `insert into mkt.brand_brain_versions
       (org_id, brand_id, version, status, claims_allowed, prohibitions, disclaimers, source_refs)
     values ($1,$2,$3,$4::mkt.lifecycle_status,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb)
     returning id, version`,
    [ids.org, ids.brand, prox.rows[0].v, status,
     JSON.stringify(claims), JSON.stringify(proibicoes), JSON.stringify(disclaimers),
     JSON.stringify(fontes ?? [{ kind: "WEB_PAGE", locator: "https://ipe.example/", hash: "h1",
                                 retrieved_at: "2026-08-26T12:00:00.000Z" }])]);
  return rows[0];
}

before(async () => {
  await db.connect();
  await limpar();
  ports = createPostgresPorts(db);
  svc = createBrandActivationService({ authoring: ports.authoring });
});

beforeEach(async () => {
  await limpar();
  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Ativ','ativ-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name, website_url)
    select w.org_id, w.id, 'Corretora Ipe', 'https://ipe.example' from w
    returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;
});

after(async () => { await limpar(); await db.end(); });

// ── O ato ───────────────────────────────────────────────────────────────────

test("ativar uma candidata a torna a marca do agente", async () => {
  const v = await versao();
  const r = await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v.id, actor: DONO });

  assert.equal(r.version.status, "ACTIVE");
  assert.ok(r.version.activated_at);
  assert.equal(r.replaced, null);

  // E agora o agente enxerga: era exatamente isto que faltava para o
  // onboarding servir para alguma coisa.
  const bb = await ports.knowledge.brandBrain(ids.org, ids.brand);
  assert.equal(String(bb.id), String(v.id));
});

test("ativar a nova rebaixa a antiga, e a marca nunca fica sem nenhuma", async () => {
  const v1 = await versao();
  await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v1.id, actor: DONO });
  const v2 = await versao();
  const r = await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v2.id, actor: DONO });

  assert.equal(r.replaced.version, v1.version);

  const { rows } = await db.query(
    `select version, status::text as status from mkt.brand_brain_versions
      where brand_id = $1 order by version`, [ids.brand]);
  assert.deepEqual(rows.map((x) => x.status), ["DEPRECATED", "ACTIVE"]);

  // O indice parcial e quem garante o "uma so": vale conferir contra ele, e
  // nao contra a nossa propria contagem.
  const ativas = await db.query(
    `select count(*)::int as n from mkt.brand_brain_versions
      where brand_id = $1 and status = 'ACTIVE'`, [ids.brand]);
  assert.equal(ativas.rows[0].n, 1);
});

test("voltar para a versao anterior e ativacao, e vem marcada como tal", async () => {
  const v1 = await versao();
  await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v1.id, actor: DONO });
  const v2 = await versao();
  await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v2.id, actor: DONO });

  const r = await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v1.id, actor: DONO });
  assert.equal(r.reverted, true);
  assert.equal(r.replaced.version, v2.version);
  assert.equal(r.version.status, "ACTIVE");
});

// ── As recusas ──────────────────────────────────────────────────────────────

test("so dono ativa: propor e de marketing, assumir como marca nao e", async () => {
  const v = await versao();
  for (const role of ["MARKETING", "APPROVER"]) {
    await assert.rejects(
      () => svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v.id, actor: { id: "u", role } }),
      (e) => e.reason_code === "ACTOR_ROLE_FORBIDDEN" && e.status === 403);
  }
  const { rows } = await db.query(
    `select status::text as status from mkt.brand_brain_versions where id = $1`, [v.id]);
  assert.equal(rows[0].status, "CANDIDATE", "nada pode ter mudado");
});

test("versao de outro tenant nao existe daqui", async () => {
  const v = await versao();
  await assert.rejects(
    () => svc.activate({
      tenant: { org_id: "00000000-0000-4000-8000-000000000000", workspace_id: ids.ws },
      brand_id: ids.brand, version_id: v.id, actor: DONO }),
    (e) => e.reason_code === "NORMALIZATION_FAILED" && e.status === 404);
});

test("ativar de novo o que ja esta ativo e estado, nao erro", async () => {
  const v = await versao();
  await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v.id, actor: DONO });
  const r = await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v.id, actor: DONO });
  assert.equal(r.already_active, true);
});

test("versao BLOCKED nao volta por um clique de ativar", async () => {
  const v = await versao({ status: "BLOCKED" });
  await assert.rejects(
    () => svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v.id, actor: DONO }),
    (e) => e.reason_code === "UNSUPPORTED_VALUE" && e.status === 409);
});

// ── O que a versao nao tem ──────────────────────────────────────────────────

test("ativar diz o que ficou faltando, em vez de deixar passar calado", async () => {
  // Toda versao extraida de site chega assim: sem proibicoes, porque uma pagina
  // nao diz o que a marca se recusa a dizer.
  const v = await versao({ proibicoes: [] });
  const r = await svc.activate({ tenant: tenant(), brand_id: ids.brand, version_id: v.id, actor: DONO });

  assert.ok(r.gaps.includes("prohibitions"));
  assert.equal(r.version.status, "ACTIVE", "a lacuna avisa, nao bloqueia");
});

test("lacunasDe e a mesma pergunta antes e depois de ativar", () => {
  assert.deepEqual(lacunasDe({ prohibitions: [], disclaimers: ["x"], claims_allowed: ["y"], source_refs: [1] }),
                   ["prohibitions"]);
  assert.deepEqual(lacunasDe({}), ["prohibitions", "disclaimers", "claims_allowed", "source_refs"]);
});

test("a listagem traz as versoes com as lacunas de cada uma", async () => {
  const v1 = await versao({ proibicoes: ["cobertura total"] });
  await versao({ proibicoes: [] });

  const lista = await svc.list({ tenant: tenant(), brand_id: ids.brand });
  assert.equal(lista.length, 2);
  assert.equal(lista[0].version, 2, "da mais nova para a mais velha");
  assert.ok(lista[0].gaps.includes("prohibitions"));
  assert.ok(!lista.find((v) => String(v.id) === String(v1.id)).gaps.includes("prohibitions"));
});
