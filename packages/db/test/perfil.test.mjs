/**
 * O perfil da empresa — o que ele aceita, o que recusa, e quem promove.
 *
 * A pergunta que estes testes protegem e uma so: o perfil e a coisa mais
 * consequente que o sistema guarda sobre um cliente, porque todo conteudo
 * gerado depois herda produto, publico e tom dele. Entao ele nao pode nascer
 * valendo, nao pode passar a valer sem dono, e nao pode conter categoria que
 * o modelo inventou.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
const ids = {};
let ports;

before(async () => {
  await db.connect();
  ports = createPostgresPorts(db, { schema: "mkt" });
  await db.query(`delete from mkt.organizations where slug = 'perfil-test'`);
  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Perfil','perfil-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id,'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name, website_url)
    select w.org_id, w.id, 'Corretora Teste', 'https://corretora.test' from w
    returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;
});

after(async () => {
  await db.query(`delete from mkt.organizations where slug = 'perfil-test'`);
  await db.end();
});

const propor = (over = {}) => ports.authoring.proposeCompanyProfile({
  org_id: ids.org, brand_id: ids.brand,
  company_type: "CORRETORA",
  identity: { nome: "Corretora Teste", o_que_faz: "seguros para familias" },
  tone_axes: { formalidade: 3, tecnicidade: 2, calor: 4 },
  products: [{ product_code: "RESIDENCIAL", citacao: "seguro residencial", is_focus: true }],
  audiences: [],
  sources: [{ field_path: "products.RESIDENCIAL", source_kind: "SITE",
              quote: "seguro residencial", confidence: "MEDIUM" }],
  actor_id: "AGT-MKT-BRAND",
  ...over,
});

test("o perfil proposto nasce CANDIDATE, e nao ha argumento que mude isso", async () => {
  const p = await propor();
  assert.equal(p.status, "CANDIDATE");

  // Nem passando status pela porta: ela nao le esse campo.
  const p2 = await propor({ status: "ACTIVE" });
  assert.equal(p2.status, "CANDIDATE");

  const ativo = await ports.knowledge.companyProfile(ids.org, ids.brand);
  assert.equal(ativo, null, "propor nao faz nenhum perfil passar a valer");
});

test("codigo fora da taxonomia nao vira produto — vira lacuna declarada", async () => {
  // O modelo mapeia fala livre para id canonico. Quando ele erra o codigo, a
  // saida errada seria criar a linha na taxonomia: o vocabulario do mercado
  // passaria a ser escrito a partir do texto de UM cliente.
  const p = await propor({
    products: [
      { product_code: "RESIDENCIAL", citacao: "residencial" },
      { product_code: "SEGURO_DE_DRONE_ARTESANAL", citacao: "a gente faz de tudo" },
    ],
    sources: [],
  });

  assert.deepEqual(p.nao_canonicos, ["produto SEGURO_DE_DRONE_ARTESANAL"]);
  assert.equal(p.produtos, 1, "so o codigo que existe entrou");

  const { rows } = await db.query(
    `select gaps from mkt.company_profile_versions where id = $1`, [p.id]);
  assert.ok(JSON.stringify(rows[0].gaps).includes("SEGURO_DE_DRONE_ARTESANAL"),
    "o que nao entrou precisa aparecer como lacuna, nao sumir");
});

test("promover exige quem promoveu", async () => {
  const p = await propor({ sources: [] });

  await assert.rejects(
    () => ports.governance.promoteCompanyProfile({
      org_id: ids.org, brand_id: ids.brand, version_id: p.id }),
    (e) => e.reason_code === "ACTOR_ROLE_FORBIDDEN",
    "quando o texto publicado estiver errado, a pergunta e 'de onde veio isso' — " +
    "e a resposta precisa chegar a uma pessoa");

  // E o banco recusa mesmo por fora da porta.
  await assert.rejects(
    () => db.query(`update mkt.company_profile_versions set status = 'ACTIVE' where id = $1`, [p.id]),
    /profile_active_tem_dono/);
});

test("promover rebaixa a anterior, e nunca ha duas ACTIVE", async () => {
  const primeira = await propor({ sources: [] });
  await ports.governance.promoteCompanyProfile({
    org_id: ids.org, brand_id: ids.brand, version_id: primeira.id, actor_id: "olga@teste" });

  const segunda = await propor({ sources: [] });
  const r = await ports.governance.promoteCompanyProfile({
    org_id: ids.org, brand_id: ids.brand, version_id: segunda.id, actor_id: "olga@teste" });

  assert.equal(r.substituida.id, primeira.id);

  const { rows } = await db.query(
    `select count(*)::int n from mkt.company_profile_versions
      where brand_id = $1 and status = 'ACTIVE'`, [ids.brand]);
  assert.equal(rows[0].n, 1);

  const ativo = await ports.knowledge.companyProfile(ids.org, ids.brand);
  assert.equal(ativo.id, segunda.id);
  assert.equal(ativo.products.length, 1, "as listas vem junto do perfil ativo");
});

test("perfil DEPRECATED nao volta por promocao", async () => {
  // Reativar o passado apagaria a razao pela qual ele foi rebaixado.
  const { rows } = await db.query(
    `select id from mkt.company_profile_versions
      where brand_id = $1 and status = 'DEPRECATED' order by version limit 1`, [ids.brand]);

  await assert.rejects(
    () => ports.governance.promoteCompanyProfile({
      org_id: ids.org, brand_id: ids.brand, version_id: rows[0].id, actor_id: "olga@teste" }),
    (e) => e.reason_code === "UNSUPPORTED_VALUE");
});

test("perfil de outra organizacao nao e promovido por engano", async () => {
  const outra = await db.query(
    `insert into mkt.organizations (name, slug) values ('Outra','perfil-test-outra') returning id`);
  const { rows } = await db.query(
    `select id from mkt.company_profile_versions where brand_id = $1 limit 1`, [ids.brand]);

  await assert.rejects(
    () => ports.governance.promoteCompanyProfile({
      org_id: outra.rows[0].id, brand_id: ids.brand, version_id: rows[0].id, actor_id: "x" }),
    (e) => e.reason_code === "NORMALIZATION_FAILED");

  await db.query(`delete from mkt.organizations where slug = 'perfil-test-outra'`);
});

test("afirmacao lida de fora sem citacao e recusada pelo banco", async () => {
  // Procedencia sem o trecho que a sustenta e "eu li em algum lugar". Quem
  // revisa o perfil precisa poder conferir se a empresa disse aquilo.
  const p = await propor({ sources: [] });
  await assert.rejects(
    () => db.query(
      `insert into mkt.profile_field_sources
         (org_id, profile_version_id, field_path, source_kind, confidence)
       values ($1,$2,'products.RESIDENCIAL','SITE','HIGH')`, [ids.org, p.id]),
    /profile_source_lido_tem_citacao/);

  // Inferencia declarada nao precisa de citacao: a ausencia de fonte E a
  // informacao, e e por isso que ela entra com confianca baixa.
  await db.query(
    `insert into mkt.profile_field_sources
       (org_id, profile_version_id, field_path, source_kind, confidence)
     values ($1,$2,'tone_observed','INFERIDO','LOW')`, [ids.org, p.id]);
});

test("o vocabulario oferecido diz se veio de taxonomia curada", async () => {
  // Enquanto ninguem curou, o extrator recebe a carga CANDIDATE — mas o
  // retorno declara isso, e o executor transforma a ressalva em lacuna no
  // proprio perfil. Um default silencioso aqui seria o mesmo erro que a
  // migration 0012 existe para impedir, com uma camada a mais de disfarce.
  const v = await ports.taxonomy.proposalVocabulary();
  assert.equal(v.curated, false);
  assert.ok(v.products.length > 20, "o vocabulario nao pode chegar vazio ao extrator");
});

test("o quadro traz a ativa e as candidatas da mesma marca", async () => {
  // Promover e substituir. Uma tela que mostrasse so a candidata pediria uma
  // decisao sobre o que muda sem mostrar o que havia antes.
  const linhas = await ports.knowledge.companyProfileBoard(ids.org, ids.ws);
  const desta = linhas.filter((l) => l.brand_id === ids.brand);

  assert.ok(desta.some((l) => l.status === "ACTIVE"), "a que vale precisa aparecer");
  assert.ok(desta.some((l) => l.status === "CANDIDATE"), "as que esperam decisao tambem");
  // DEPRECATED nao aparece: o quadro serve para decidir, e versao rebaixada
  // nao tem decisao pendente.
  assert.ok(!desta.some((l) => l.status === "DEPRECATED"));

  const ativa = desta.find((l) => l.status === "ACTIVE");
  assert.ok(Array.isArray(ativa.products), "as listas vem junto, para a tela nao ter de buscar de novo");
  assert.ok(Array.isArray(ativa.sources));
  assert.ok(Array.isArray(ativa.gaps));
});

test("marca sem perfil nenhum aparece no quadro, com a linha vazia", async () => {
  // Sumir com a marca esconderia justamente quem precisa de onboarding.
  const semPerfil = await db.query(
    `insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'Marca Nova') returning id`,
    [ids.org, ids.ws]);

  const linhas = await ports.knowledge.companyProfileBoard(ids.org, ids.ws);
  const nova = linhas.find((l) => l.brand_id === semPerfil.rows[0].id);

  assert.ok(nova, "a marca sem perfil precisa aparecer");
  assert.equal(nova.version_id, null);
});

test("o quadro nao alcanca marca de outro workspace", async () => {
  const wsB = await db.query(
    `insert into mkt.workspaces (org_id, name) values ($1,'Unidade B') returning id`, [ids.org]);
  await db.query(
    `insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'Marca da B')`,
    [ids.org, wsB.rows[0].id]);

  const linhas = await ports.knowledge.companyProfileBoard(ids.org, ids.ws);
  assert.ok(!linhas.some((l) => l.brand_name === "Marca da B"),
    "o quadro e do workspace da sessao");
});
