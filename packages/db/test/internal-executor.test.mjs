/**
 * Executor das capabilities internas, contra o banco de verdade.
 *
 * O teste unitario do adapter (packages/gateway/test/internal-adapter.test.mjs)
 * responde "a decisao esta certa?". Este aqui responde outra pergunta, que
 * dubles nao conseguem responder: o SQL faz o que o adapter acredita que faz?
 *
 * A diferenca ja custou caro neste projeto mais de uma vez. `budget.record`
 * tinha teste unitario passando e faltava org_id — o duble nao tinha coluna
 * obrigatoria para reclamar. Constraint, trigger e RLS so aparecem aqui.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createInternalAdapter } from "@olga/gateway/adapters";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });

const ids = {};
let ports, adapter;

const limpar = () => db.query(`delete from mkt.organizations where slug = 'exec-test'`);

/** Redator roteirizado: devolve o que o teste mandar. */
const redatorFixo = (draft, variant, proposta) => ({
  async draft() { return draft; },
  async variant() { return variant ?? { headline: "H", body: "Corpo do canal.", cta: null }; },
  async brandBrain() {
    return proposta ?? {
      identity: { nome: "Corretora", o_que_faz: "seguros para familias" },
      tone: { descricao: "direto e sem jargao" },
      claims_allowed: [], prohibitions: ["milagre"], disclaimers: [],
      nao_encontrado: ["disclaimer de cobertura"],
    };
  },
});

const pedido = (args, extra = {}) => ({
  trace_id: "tr_exec", tenant: { org_id: ids.org, workspace_id: ids.ws, actor_id: "u-exec" },
  args, ...extra,
});
const cap = (capability_id) => ({ capability_id });

before(async () => {
  await db.connect();
  await limpar();

  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Exec','exec-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name, website_url)
    select w.org_id, w.id, 'Corretora', 'https://corretora.test' from w
    returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id; ids.org = r.rows[0].org_id; ids.ws = r.rows[0].workspace_id;

  const bb = await db.query(`
    insert into mkt.brand_brain_versions (org_id, brand_id, version, status, prohibitions, disclaimers)
    values ($1,$2,1,'ACTIVE','["cobertura total","garantido"]'::jsonb,
            '["Consulte as condicoes gerais."]'::jsonb)
    returning id`, [ids.org, ids.brand]);
  ids.bb = bb.rows[0].id;

  const ev = await db.query(`
    insert into mkt.evidence (org_id, workspace_id, source_kind, locator, hash, fact, quality)
    values ($1,$2,'SOURCE_ARTIFACT','https://corretora.test/apolice','h1','Apolice cobre enchente','HIGH')
    returning id`, [ids.org, ids.ws]);
  ids.ev = ev.rows[0].id;

  ports = createPostgresPorts(db, { schema: "mkt" });
  adapter = createInternalAdapter({
    authoring: ports.authoring, knowledge: ports.knowledge, publishing: ports.publishing,
    compose: redatorFixo({ title: "Titulo", master_body: "Corpo neutro do post.", claims: [] }),
  });
});

after(async () => { await limpar(); await db.end(); });

/** Adapter com o mesmo banco e um corpo proprio, para nao esbarrar no duplicate_risk. */
const outroAdapter = (master_body) => createInternalAdapter({
  authoring: ports.authoring, knowledge: ports.knowledge, publishing: ports.publishing,
  compose: redatorFixo({ title: "Titulo", master_body, claims: [] }),
});

// ── Registry e codigo dizendo a mesma coisa ─────────────────────────────────

test("toda capability que o registry manda para 'internal' tem executor", async () => {
  const { rows } = await db.query(
    `select capability_id from mkt.capability_registry
      where provider_adapter is null and status = 'ACTIVE'`);
  const doRegistry = rows.map((r) => r.capability_id).sort();
  const doCodigo = [...adapter.capabilities].sort();

  // Esta e a divergencia que so aparece em producao: uma capability entra no
  // registry por migracao, ninguem escreve o handler, e o gateway responde
  // "capability interna sem executor" para o primeiro cliente que pedir.
  assert.deepEqual(doRegistry, doCodigo,
    `registry e adapter divergem.\n  so no registry: ${doRegistry.filter((x) => !doCodigo.includes(x))}\n` +
    `  so no codigo:   ${doCodigo.filter((x) => !doRegistry.includes(x))}`);
});

test("toda capability com provider_adapter aponta para um adapter que existe", async () => {
  const { rows } = await db.query(
    `select distinct provider_adapter from mkt.capability_registry
      where provider_adapter is not null`);
  const conhecidos = new Set(["meta_graph", "web_fetch", "internal"]);
  for (const { provider_adapter } of rows) {
    assert.ok(conhecidos.has(provider_adapter), `adapter desconhecido no registry: ${provider_adapter}`);
  }
});

// ── Leitura ─────────────────────────────────────────────────────────────────

test("brand.read traz o Brand Brain ACTIVE do banco", async () => {
  const r = await adapter.call({ capability: cap("brand.read"), request: pedido({ brand_id: ids.brand }) });
  assert.equal(r.external_id, ids.bb);
  assert.equal(r.output.brand_name, "Corretora");
  assert.deepEqual(r.output.prohibitions, ["cobertura total", "garantido"]);
});

// ── Escrita: a transacao e a constraint ─────────────────────────────────────

test("create_draft grava conteudo, versao e claims numa transacao so", async () => {
  const a = createInternalAdapter({
    authoring: ports.authoring, knowledge: ports.knowledge, publishing: ports.publishing,
    compose: redatorFixo({
      title: "Enchente", master_body: "Falamos sobre enchente.",
      claims: [{ text: "Falamos sobre enchente.", claim_type: "GENERAL", material: false }],
    }),
  });
  const r = await a.call({
    capability: cap("content.create_draft"),
    request: pedido({ brand_id: ids.brand, objective: "EDUCAR",
                      agent_id: "AGT-MKT-CONTENT", agent_version: 1 }),
  });
  ids.cv_criado = r.external_id;

  const { rows } = await db.query(
    `select cv.state::text as state, cv.agent_id, cv.brand_brain_version_id, cv.trace_id,
            ct.title, ct.objective, ct.created_by_actor_type::text as ator,
            (select count(*) from mkt.claims c where c.content_version_id = cv.id) as claims
       from mkt.content_versions cv join mkt.contents ct on ct.id = cv.content_id
      where cv.id = $1`, [r.external_id]);

  assert.equal(rows[0].state, "DRAFT", "conteudo novo nasce DRAFT");
  assert.equal(rows[0].agent_id, "AGT-MKT-CONTENT");
  assert.equal(rows[0].brand_brain_version_id, ids.bb, "a versao da marca usada fica gravada");
  assert.equal(rows[0].trace_id, "tr_exec");
  assert.equal(rows[0].ator, "agent");
  assert.equal(Number(rows[0].claims), 1);
});

test("claim material sem evidence nao entra: nem o conteudo fica pela metade", async () => {
  // O adapter recusa antes de gravar; este teste prova que, mesmo se ele nao
  // recusasse, a constraint derruba a transacao inteira — nao sobra conteudo
  // orfao dizendo o que ninguem verificou.
  const antes = await db.query(
    `select count(*) as n from mkt.contents where workspace_id = $1`, [ids.ws]);

  await assert.rejects(
    () => ports.authoring.createDraft({
      org_id: ids.org, workspace_id: ids.ws, brand_id: ids.brand,
      title: "Promessa", master_body: "Cobertura total garantida.",
      claims: [{ text: "Cobertura total garantida.", claim_type: "COVERAGE", material: true, evidence_ids: [] }],
    }),
    (e) => /claim_material_requires_evidence/.test(String(e.message)));

  const depois = await db.query(
    `select count(*) as n from mkt.contents where workspace_id = $1`, [ids.ws]);
  assert.equal(depois.rows[0].n, antes.rows[0].n, "a transacao inteira voltou atras");
});

test("claim material COM evidence entra", async () => {
  const r = await ports.authoring.createDraft({
    org_id: ids.org, workspace_id: ids.ws, brand_id: ids.brand,
    title: "Enchente coberta", master_body: "A apolice cobre enchente.",
    claims: [{ text: "A apolice cobre enchente.", claim_type: "COVERAGE",
               material: true, evidence_ids: [ids.ev] }],
  });
  ids.cv_material = r.content_version_id;
  const { rows } = await db.query(
    `select cardinality(evidence_ids) as n from mkt.claims where content_version_id = $1`, [r.content_version_id]);
  assert.equal(Number(rows[0].n), 1);
});

// ── Os checks, com o banco por tras ─────────────────────────────────────────

test("precheck contra o banco: claim material com evidence passa", async () => {
  const r = await adapter.call({ capability: cap("quality.precheck"),
                                 request: pedido({ content_version_id: ids.cv_material }) });
  assert.equal(r.output.valid, true, JSON.stringify(r.output));
});

test("precheck acusa duplicata de texto identico, ignorando caixa e espaco", async () => {
  const gemeo = await ports.authoring.createDraft({
    org_id: ids.org, workspace_id: ids.ws, brand_id: ids.brand,
    title: "Copia", master_body: "  A APOLICE   cobre   ENCHENTE.  ",
  });
  const r = await adapter.call({ capability: cap("quality.precheck"),
                                 request: pedido({ content_version_id: gemeo.content_version_id }) });
  assert.ok(r.output.reason_codes.includes("CONTENT_DUPLICATE_RISK"), JSON.stringify(r.output));

  // E a versao original tambem enxerga a copia: a relacao e simetrica.
  const r2 = await adapter.call({ capability: cap("quality.precheck"),
                                  request: pedido({ content_version_id: ids.cv_material }) });
  assert.ok(r2.output.reason_codes.includes("CONTENT_DUPLICATE_RISK"));

  await db.query(`delete from mkt.contents where id = (select content_id from mkt.content_versions where id = $1)`,
                 [gemeo.content_version_id]);
});

test("duplicata nao atravessa workspace", async () => {
  const w2 = await db.query(`insert into mkt.workspaces (org_id, name) values ($1,'Outro') returning id`, [ids.org]);
  const b2 = await db.query(
    `insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'Outra') returning id`,
    [ids.org, w2.rows[0].id]);
  const fora = await ports.authoring.createDraft({
    org_id: ids.org, workspace_id: w2.rows[0].id, brand_id: b2.rows[0].id,
    title: "Igual", master_body: "A apolice cobre enchente.",
  });
  const achado = await ports.knowledge.duplicateOf(ids.org, ids.ws, ids.cv_material);
  assert.equal(achado, null, "conteudo de outro workspace nao e duplicata deste");
  await db.query(`delete from mkt.workspaces where id = $1`, [w2.rows[0].id]);
  assert.ok(fora.content_version_id);
});

test("compliance contra o banco: termo proibido do Brand Brain e achado", async () => {
  const proibido = await ports.authoring.createDraft({
    org_id: ids.org, workspace_id: ids.ws, brand_id: ids.brand,
    title: "Exagero", master_body: "Oferecemos COBERTURA TOTAL para tudo.",
  });
  const r = await adapter.call({ capability: cap("compliance.review"),
                                 request: pedido({ content_version_id: proibido.content_version_id }) });
  assert.equal(r.output.valid, false);
  assert.ok(r.output.reason_codes.includes("COMPLIANCE_REVIEW_REQUIRED"));
  assert.match(r.output.checks.find((c) => c.check === "prohibitions").detail, /cobertura total/);
});

// ── approval.request e publishing.schedule ─────────────────────────────────

test("approval.request nao tira conteudo de DRAFT: AI_REVIEW vem antes", async () => {
  // A state machine da J11 nao liga DRAFT a revisao humana. Isso ja estourava
  // como INVALID_STATE_TRANSITION cru do trigger; agora e recusa nomeada.
  await assert.rejects(
    () => adapter.call({
      capability: cap("approval.request"),
      request: pedido({ content_version_id: ids.cv_criado, reason_codes: [] }),
    }),
    (e) => e.reason_code === "CONTENT_NOT_APPROVED" && /AI_REVIEW/.test(e.message));

  const { rows } = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [ids.cv_criado]);
  assert.equal(rows[0].state, "DRAFT", "a recusa nao pode ter mexido no estado");
});

test("approval.request com COMPLIANCE_REVIEW_REQUIRED leva para revisao de compliance", async () => {
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [ids.cv_criado]);

  const r = await adapter.call({
    capability: cap("approval.request"),
    request: pedido({ content_version_id: ids.cv_criado, reason_codes: ["COMPLIANCE_REVIEW_REQUIRED"] }),
  });
  assert.equal(r.output.state, "COMPLIANCE_REVIEW");
  const { rows } = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [ids.cv_criado]);
  assert.equal(rows[0].state, "COMPLIANCE_REVIEW");

  // O destino sai dos reason codes, nao de um parametro: sem o codigo de
  // compliance o mesmo pedido teria ido para a fila humana comum.
  const ap = await db.query(
    `select requested_reason_codes from mkt.approvals where subject_id = $1`, [ids.cv_criado]);
  assert.deepEqual(ap.rows[0].requested_reason_codes, ["COMPLIANCE_REVIEW_REQUIRED"]);
});

test("publishing.schedule recusa conteudo nao aprovado com CONTENT_NOT_APPROVED", async () => {
  const conn = await db.query(
    `insert into mkt.connections (org_id, workspace_id, channel, provider, external_account_id, status)
     values ($1,$2,'INSTAGRAM','meta','17841400000000001','ACTIVE') returning id`, [ids.org, ids.ws]);
  const v = await ports.authoring.createVariant({
    org_id: ids.org, content_version_id: ids.cv_material, channel: "INSTAGRAM", body: "Corpo." });

  await assert.rejects(
    () => adapter.call({
      capability: cap("publishing.schedule"),
      request: pedido({ content_version_id: ids.cv_material, channel: "INSTAGRAM",
                        connection_id: conn.rows[0].id, channel_variant_id: v.id }),
    }),
    (e) => e.reason_code === "CONTENT_NOT_APPROVED");

  // E nada foi para o outbox: sem transicao valida nao ha evento.
  const { rows } = await db.query(
    `select count(*) as n from mkt.outbox where org_id = $1 and event_type = 'olga/content.publish.requested'`,
    [ids.org]);
  assert.equal(Number(rows[0].n), 0);
  ids.conn = conn.rows[0].id;
  ids.variant = v.id;
});

test("publishing.schedule aprovado agenda e enfileira no outbox, numa transacao", async () => {
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [ids.cv_material]);
  await db.query(`update mkt.content_versions set state = 'APPROVED' where id = $1`, [ids.cv_material]);

  const r = await adapter.call({
    capability: cap("publishing.schedule"),
    request: pedido({ content_version_id: ids.cv_material, channel: "INSTAGRAM",
                      connection_id: ids.conn, channel_variant_id: ids.variant },
                    { requested_autonomy: "A3" }),
    // A policy rebaixou para A2. E isso que tem de ficar gravado, nao o A3
    // que foi pedido.
    granted_autonomy: "A2",
  });

  const pub = await db.query(
    `select status::text as status, autonomy_used::text as autonomy from mkt.publications where id = $1`,
    [r.output.publication_id]);
  assert.equal(pub.rows[0].status, "SCHEDULED");
  assert.equal(pub.rows[0].autonomy, "A2");

  const cv = await db.query(`select state::text as state from mkt.content_versions where id = $1`, [ids.cv_material]);
  assert.equal(cv.rows[0].state, "SCHEDULED");

  const ob = await db.query(
    `select payload from mkt.outbox where id = $1`, [r.output.outbox_id]);
  assert.equal(ob.rows[0].payload.publication_id, r.output.publication_id);
});

// ── brand.propose_version ───────────────────────────────────────────────────

test("propose_version cria CANDIDATE, com a fonte virada evidence, e nao encosta na ACTIVE", async () => {
  const r = await adapter.call({
    capability: cap("brand.propose_version"),
    request: pedido({
      brand_id: ids.brand, workspace_id: ids.ws,
      source_url: "https://corretora.test/sobre",
      source_text: "Somos a Corretora. Cuidamos do seguro da sua familia.",
      source_hash: "hpagina",
    }),
  });
  assert.equal(r.output.status, "CANDIDATE");
  assert.equal(r.output.version, 2);
  assert.deepEqual(r.output.nao_encontrado, ["disclaimer de cobertura"]);

  const { rows } = await db.query(
    `select status::text as status, version, prohibitions, source_refs
       from mkt.brand_brain_versions where brand_id = $1 order by version`, [ids.brand]);
  assert.deepEqual(rows.map((x) => x.status), ["ACTIVE", "CANDIDATE"]);
  assert.deepEqual(rows[1].prohibitions, ["milagre"]);

  // A procedencia aponta para uma linha de evidence que EXISTE. Um Brand Brain
  // que cita fonte que ninguem consegue abrir e o mesmo que um sem fonte.
  const ref = rows[1].source_refs[0];
  assert.equal(ref.url, "https://corretora.test/sobre");
  const ev = await db.query(
    `select source_kind, locator, hash from mkt.evidence where id = $1`, [ref.evidence_id]);
  assert.equal(ev.rows[0].source_kind, "SOURCE_ARTIFACT");
  assert.equal(ev.rows[0].hash, "hpagina");

  // A ACTIVE continua sendo a que o resto do sistema le.
  const ativa = await ports.knowledge.brandBrain(ids.org, ids.brand);
  assert.equal(ativa.version, 1);
});

test("propose_version sem pagina lida nao grava versao nenhuma", async () => {
  const antes = await db.query(
    `select count(*) as n from mkt.brand_brain_versions where brand_id = $1`, [ids.brand]);
  await assert.rejects(
    () => adapter.call({ capability: cap("brand.propose_version"),
                         request: pedido({ brand_id: ids.brand }) }),
    (e) => e.reason_code === "EVIDENCE_INSUFFICIENT");
  const depois = await db.query(
    `select count(*) as n from mkt.brand_brain_versions where brand_id = $1`, [ids.brand]);
  assert.equal(depois.rows[0].n, antes.rows[0].n);
});

// ── DRAFT -> AI_REVIEW: o passo que faltava para o produto andar ────────────
//
// Antes da migration 0011, conteudo criado por agente ficava preso em DRAFT
// para sempre: `approval.request` exige AI_REVIEW e a state machine da J11 nao
// deixa pular. O caminho de ponta a ponta so andava nos testes, porque eles
// posicionavam o estado com um UPDATE.

test("o registry declara que quality.precheck tem efeito interno", async () => {
  // O handler so pode escrever porque o registry declara que ele escreve. Se
  // esta linha voltar para 'none', o codigo passa a fazer o que o contrato
  // proibe — e a divergencia tem de aparecer aqui, nao em producao.
  const { rows } = await db.query(
    `select mode::text as mode, side_effect::text as side_effect
       from mkt.capability_registry
      where capability_id = 'quality.precheck' and version = 1`);
  assert.equal(rows[0].side_effect, "internal");
  assert.equal(rows[0].mode, "simulate",
    "o gate de QUALITY_BLOCKED no loop e ligado ao modo; mudar para write o desliga");
});

test("precheck que passa leva o rascunho de DRAFT para AI_REVIEW", async () => {
  const criado = await adapter.call({
    capability: cap("content.create_draft"),
    request: pedido({ brand_id: ids.brand, title: "T", objective: null, channel: "INSTAGRAM" }),
  });
  const cvid = criado.output.content_version_id;

  const antes = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [cvid]);
  assert.equal(antes.rows[0].state, "DRAFT", "conteudo novo nasce DRAFT");

  const laudo = await adapter.call({
    capability: cap("quality.precheck"), request: pedido({ content_version_id: cvid }),
  });
  assert.equal(laudo.output.valid, true);

  const depois = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [cvid]);
  assert.equal(depois.rows[0].state, "AI_REVIEW");
});

test("agora o rascunho revisado alcanca a fila humana", async () => {
  // Este e o aceite de verdade: antes da 0011 esta sequencia terminava em
  // CONTENT_NOT_APPROVED, e nenhum teste a exercia sem preparar o estado.
  //
  // Corpo proprio de proposito. Com o texto do rascunho anterior, o check
  // duplicate_risk reprova — corretamente — e o laudo nao promoveria nada.
  // Foi assim que este teste falhou da primeira vez, e a checagem estava
  // certa: quem tinha de mudar era o caso.
  const criado = await outroAdapter("Segundo corpo, diferente do primeiro.").call({
    capability: cap("content.create_draft"),
    request: pedido({ brand_id: ids.brand, title: "T2", objective: null, channel: "INSTAGRAM" }),
  });
  const cvid = criado.output.content_version_id;

  await adapter.call({ capability: cap("quality.precheck"), request: pedido({ content_version_id: cvid }) });
  const ap = await adapter.call({
    capability: cap("approval.request"),
    request: pedido({ content_version_id: cvid, reason_codes: ["WORKSPACE_FIRST_PUBLISH"] }),
  });

  assert.equal(ap.output.state, "HUMAN_REVIEW");
  const { rows } = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [cvid]);
  assert.equal(rows[0].state, "HUMAN_REVIEW");
});

test("precheck reexecutado sobre conteudo aprovado nao rebaixa a decisao humana", async () => {
  const criado = await outroAdapter("Terceiro corpo, tambem distinto.").call({
    capability: cap("content.create_draft"),
    request: pedido({ brand_id: ids.brand, title: "T3", objective: null, channel: "INSTAGRAM" }),
  });
  const cvid = criado.output.content_version_id;
  await db.query(
    `update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [cvid]);
  await db.query(
    `update mkt.content_versions set state = 'APPROVED' where id = $1`, [cvid]);

  await adapter.call({ capability: cap("quality.precheck"), request: pedido({ content_version_id: cvid }) });

  const { rows } = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [cvid]);
  assert.equal(rows[0].state, "APPROVED",
    "revisao de IA reexecutada nao desfaz o que um humano ja decidiu");
});

test("precheck que reprova deixa o rascunho onde estava", async () => {
  const cvid = (await db.query(`
    with c as (insert into mkt.contents (org_id, workspace_id, brand_id, title,
                                         created_by_actor_type, created_by_actor_id)
               values ($1,$2,$3,'Com claim','agent','a') returning id)
    insert into mkt.content_versions (org_id, content_id, version, master_body, state)
    select $1, id, 1, 'Cobrimos tudo.', 'DRAFT' from c returning id`,
    [ids.org, ids.ws, ids.brand])).rows[0].id;

  // Claim material cuja evidence some depois: e disso que CLAIM_UNSUPPORTED
  // fala — "o que sustentava sumiu".
  await db.query(
    `insert into mkt.claims (org_id, content_version_id, text, material, claim_type, evidence_ids)
     values ($1,$2,'Cobrimos tudo.',true,'COVERAGE',array[$3]::uuid[])`,
    [ids.org, cvid, "00000000-0000-4000-8000-0000000000ff"]);

  const laudo = await adapter.call({
    capability: cap("quality.precheck"), request: pedido({ content_version_id: cvid }),
  });

  assert.equal(laudo.output.valid, false);
  const { rows } = await db.query(
    `select state::text as state from mkt.content_versions where id = $1`, [cvid]);
  assert.equal(rows[0].state, "DRAFT", "reprovado nao anda");
});

// ── Conexoes de canal, gravadas pelo consentimento no navegador ────────────

test("conectar grava a conexao ACTIVE com secret_ref, e nunca o token", async () => {
  const c = await ports.connections.upsert({
    org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM", provider: "meta",
    external_account_id: "ig-777", display_name: "corretora",
    secret_ref: "vault://meta/ig-777",
    scopes: ["instagram_basic", "instagram_content_publish"],
    expires_at: new Date(Date.now() + 60 * 86400000).toISOString(),
  });

  assert.equal(c.status, "ACTIVE");
  assert.equal(c.external_account_id, "ig-777");

  // A tabela nao tem coluna para token, e este teste existe para que ela
  // continue nao tendo: o dia em que alguem acrescentar uma, ele acusa.
  const { rows } = await db.query(
    `select column_name from information_schema.columns
      where table_schema = 'mkt' and table_name = 'connections'`);
  const colunas = rows.map((r) => r.column_name);
  for (const proibida of ["access_token", "token", "secret", "password"]) {
    assert.ok(!colunas.includes(proibida),
      `mkt.connections ganhou a coluna ${proibida}: segredo nao mora no banco de dominio`);
  }
});

test("reconectar atualiza a mesma linha em vez de criar outra", async () => {
  // Reconexao e rotina, nao excecao: o token longo da Meta dura 60 dias. Duas
  // linhas para a mesma conta deixariam a publicacao escolhendo uma delas.
  const args = {
    org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM", provider: "meta",
    external_account_id: "ig-888", secret_ref: "vault://meta/ig-888",
  };
  const a = await ports.connections.upsert({ ...args, display_name: "antigo" });
  const b = await ports.connections.upsert({ ...args, display_name: "novo" });

  assert.equal(a.id, b.id, "a constraint diz o que e a mesma conexao; o upsert obedece");
  assert.equal(b.display_name, "novo");
});

test("conexao sem secret_ref e recusada antes de chegar ao banco", async () => {
  await assert.rejects(
    () => ports.connections.upsert({
      org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM",
      provider: "meta", external_account_id: "ig-999", secret_ref: null,
    }),
    (e) => e.reason_code === "CHANNEL_NOT_CONNECTED");
});

test("revogar preserva a linha e devolve a referencia do segredo a apagar", async () => {
  const c = await ports.connections.upsert({
    org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM", provider: "meta",
    external_account_id: "ig-666", secret_ref: "vault://meta/ig-666",
  });

  const r = await ports.connections.revoke(ids.org, c.id);
  // O secret_ref ANTIGO tem de voltar: quem chama precisa dele para apagar o
  // segredo no vault, e depois do update ele ja e null.
  assert.equal(r.secret_ref, "vault://meta/ig-666");

  const { rows } = await db.query(
    `select status::text as status, secret_ref from mkt.connections where id = $1`, [c.id]);
  assert.equal(rows[0].status, "REVOKED");
  assert.equal(rows[0].secret_ref, null);
  assert.equal(rows.length, 1, "revogar nao apaga a linha: publications aponta para ela");

  // Revogar de novo nao acha nada para revogar, e isso e resposta, nao erro.
  assert.equal(await ports.connections.revoke(ids.org, c.id), null);
});

test("revogar conexao de outra organizacao nao encontra nada", async () => {
  const c = await ports.connections.upsert({
    org_id: ids.org, workspace_id: ids.ws, channel: "INSTAGRAM", provider: "meta",
    external_account_id: "ig-555", secret_ref: "vault://meta/ig-555",
  });
  const outra = "00000000-0000-4000-8000-000000000abc";
  assert.equal(await ports.connections.revoke(outra, c.id), null);
});
