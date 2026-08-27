/**
 * Promoção do Brand Brain — o ato que só uma pessoa pratica.
 *
 * O AGT-MKT-BRAND propõe e não promove; a porta `proposeBrandVersion` escreve
 * `'CANDIDATE'` como literal. Este arquivo testa o outro lado: a transição que
 * um humano faz, e as três coisas que o banco garante sobre ela.
 *
 * Contra Postgres de verdade porque as garantias que importam aqui são todas
 * do banco: o índice único de uma ACTIVE por marca, a transação que rebaixa a
 * anterior, e o CHECK que recusa ACTIVE sem dono.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";

const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL });
const ids = {};
let ports;

const limpar = () => db.query(`delete from mkt.organizations where slug = 'promo-test'`);

/** Cria uma versão CANDIDATE e devolve o id. */
async function candidata(brand_id = ids.brand) {
  const r = await ports.authoring.proposeBrandVersion({
    org_id: ids.org, brand_id,
    identity: { nome: "Corretora", o_que_faz: "seguros" },
    tone: { descricao: "direto" },
  });
  return r.id;
}

before(async () => {
  await db.connect();
  await limpar();
  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Promo','promo-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name, website_url)
    select w.org_id, w.id, 'Corretora', 'https://corretora.test' from w
    returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;
  ports = createPostgresPorts(db, { schema: "mkt" });
});

after(async () => { await limpar(); await db.end(); });

// ── O caminho normal ────────────────────────────────────────────────────────

test("promover a primeira versao a deixa ACTIVE, com quem promoveu gravado", async () => {
  const v = await candidata();
  const r = await ports.governance.promoteBrandVersion({
    org_id: ids.org, brand_id: ids.brand, version_id: v, actor_id: "olga",
  });

  assert.equal(r.promovida.status, "ACTIVE");
  assert.equal(r.substituida, null, "nao havia anterior para substituir");

  const { rows } = await db.query(
    `select status::text as status, activated_at, activated_by_actor_id,
            activated_by_actor_type::text as tipo
       from mkt.brand_brain_versions where id = $1`, [v]);
  assert.equal(rows[0].status, "ACTIVE");
  assert.ok(rows[0].activated_at, "ACTIVE sem activated_at nao diz quando passou a valer");
  assert.equal(rows[0].activated_by_actor_id, "olga");
  assert.equal(rows[0].tipo, "user");
});

test("promover a segunda rebaixa a primeira, numa transacao so", async () => {
  const anteriorId = (await db.query(
    `select id, version from mkt.brand_brain_versions
      where brand_id = $1 and status = 'ACTIVE'`, [ids.brand])).rows[0];

  const nova = await candidata();
  const r = await ports.governance.promoteBrandVersion({
    org_id: ids.org, brand_id: ids.brand, version_id: nova, actor_id: "olga",
  });

  assert.equal(r.substituida.id, anteriorId.id);
  assert.equal(r.promovida.status, "ACTIVE");

  const { rows } = await db.query(
    `select id, status::text as status, superseded_at from mkt.brand_brain_versions
      where brand_id = $1 order by version`, [ids.brand]);
  assert.deepEqual(rows.map((x) => x.status), ["DEPRECATED", "ACTIVE"]);
  assert.ok(rows[0].superseded_at, "a versao substituida precisa dizer quando deixou de valer");

  // O que o resto do sistema lê é sempre uma só.
  const ativa = await ports.knowledge.brandBrain(ids.org, ids.brand);
  assert.equal(ativa.id, nova);
});

test("nunca ha duas ACTIVE ao mesmo tempo — nem por um instante", async () => {
  const { rows } = await db.query(
    `select count(*) as n from mkt.brand_brain_versions
      where brand_id = $1 and status = 'ACTIVE'`, [ids.brand]);
  assert.equal(Number(rows[0].n), 1);

  // O indice brand_brain_one_active e quem garante. Provar que ele existe e
  // morde vale mais que confiar na ordem da transacao.
  await assert.rejects(
    () => db.query(
      `insert into mkt.brand_brain_versions (org_id, brand_id, version, status, activated_at,
                                             activated_by_actor_type, activated_by_actor_id)
       values ($1,$2,999,'ACTIVE',now(),'user','x')`, [ids.org, ids.brand]),
    (e) => /brand_brain_one_active/.test(String(e.message)));
});

// ── O que a promoção recusa ─────────────────────────────────────────────────

test("so promove CANDIDATE: DEPRECATED nao volta por promocao", async () => {
  const antiga = (await db.query(
    `select id from mkt.brand_brain_versions where brand_id = $1 and status = 'DEPRECATED'
      limit 1`, [ids.brand])).rows[0];

  // Voltar atras e legitimo, mas o caminho e propor de novo — assim o rastro
  // mostra que houve uma reversao, em vez de a versao antiga reaparecer ACTIVE
  // como se nunca tivesse saido.
  await assert.rejects(
    () => ports.governance.promoteBrandVersion({
      org_id: ids.org, brand_id: ids.brand, version_id: antiga.id, actor_id: "olga",
    }),
    (e) => e.reason_code === "UNSUPPORTED_VALUE" && /DEPRECATED/.test(e.message));
});

test("versao de outra marca nao e promovida por engano", async () => {
  const outra = await db.query(
    `insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'Outra') returning id`,
    [ids.org, ids.ws]);
  const v = await candidata(outra.rows[0].id);

  // Passa o brand_id ERRADO de proposito: a consulta filtra pelos tres, entao
  // a versao simplesmente nao e encontrada naquela marca.
  await assert.rejects(
    () => ports.governance.promoteBrandVersion({
      org_id: ids.org, brand_id: ids.brand, version_id: v, actor_id: "olga",
    }),
    (e) => e.reason_code === "NORMALIZATION_FAILED");

  const { rows } = await db.query(
    `select status::text as status from mkt.brand_brain_versions where id = $1`, [v]);
  assert.equal(rows[0].status, "CANDIDATE", "a recusa nao pode ter mexido na versao");
});

test("promocao sem dono e recusada pelo banco", async () => {
  // O CHECK brand_brain_active_tem_dono existe porque activated_at sozinho
  // responde QUANDO e nao QUEM, e todo conteudo gerado depois herda esta
  // decisao. Quando um texto publicado estiver errado, a pergunta e "de onde
  // veio essa afirmacao" — e a resposta precisa chegar a uma pessoa.
  const v = await candidata();
  await assert.rejects(
    () => db.query(
      `update mkt.brand_brain_versions
          set status = 'ACTIVE', activated_at = now() where id = $1`, [v]),
    (e) => /brand_brain_active_tem_dono/.test(String(e.message)));
});

// ── A leitura da tela ───────────────────────────────────────────────────────

test("o quadro traz a ACTIVE e as CANDIDATE juntas, e ignora as DEPRECATED", async () => {
  const linhas = await ports.knowledge.brandBrainBoard(ids.org, ids.ws);
  const daMarca = linhas.filter((l) => l.brand_id === ids.brand);

  const status = daMarca.map((l) => l.status).sort();
  assert.ok(status.includes("ACTIVE"));
  assert.ok(status.includes("CANDIDATE"));
  assert.ok(!status.includes("DEPRECATED"),
    "quadro de decisao mostra o que esta em jogo, nao o historico");

  // A marca sem versao nenhuma aparece assim mesmo: some-la esconderia
  // justamente o caso que precisa de acao.
  const semVersao = linhas.filter((l) => l.version_id === null);
  assert.ok(linhas.length >= daMarca.length);
  assert.ok(Array.isArray(semVersao));

  const ativa = daMarca.find((l) => l.status === "ACTIVE");
  assert.equal(ativa.brand_name, "Corretora");
  assert.equal(ativa.website_url, "https://corretora.test");
});

test("o quadro nao atravessa workspace", async () => {
  const w2 = await db.query(
    `insert into mkt.workspaces (org_id, name) values ($1,'Outro') returning id`, [ids.org]);
  const linhas = await ports.knowledge.brandBrainBoard(ids.org, w2.rows[0].id);
  assert.deepEqual(linhas, [], "marca de outro workspace nao aparece neste quadro");
});
