/**
 * Aprovacao contra Postgres real (T4).
 *
 * O criterio de aceite do handoff e uma frase: "aprovar, editar, e a aprovacao
 * cai. Teste, nao clique." E isto aqui.
 *
 * O ponto de todo o arquivo: a queda da aprovacao nao e feita pela aplicacao.
 * Quem derruba e o trigger mkt.invalidate_approval_on_edit(), no banco. A
 * aplicacao so precisa nao contrariar. Um teste que passasse com a logica so
 * em JavaScript nao provaria nada — por isso ele roda contra o banco de verdade.
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createApprovalService, evaluateApproval } from "@olga/runtime/approvals";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
const ids = {};
let ports, svc;

const limpar = async () => {
  await db.query(`delete from mkt.organizations where slug = 'aprov-test'`);
  await db.query(`delete from mkt.app_users where email = 'aprovador@olga.test'`);
};

before(async () => {
  await db.connect();
  await limpar();

  const u = await db.query(
    `insert into mkt.app_users (email, full_name) values ('aprovador@olga.test','Aprovadora') returning id`);
  ids.user = u.rows[0].id;

  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Aprov Test','aprov-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name)
    select w.org_id, w.id, 'Marca' from w returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id;
  ids.org = r.rows[0].org_id;
  ids.ws = r.rows[0].workspace_id;

  ports = createPostgresPorts(db, { schema: "mkt" });
  svc = createApprovalService({ approvals: ports.approvals });
});

after(async () => { await limpar(); await db.end(); });

/**
 * Conteudo pronto para decisao: DRAFT -> AI_REVIEW, que e o unico caminho que
 * a state machine abre a partir de DRAFT.
 */
async function conteudoEmRevisao(corpo = "Texto original aprovado pela Ana.") {
  const c = await db.query(
    `insert into mkt.contents (org_id, workspace_id, brand_id, title) values ($1,$2,$3,'Post') returning id`,
    [ids.org, ids.ws, ids.brand]);
  const cv = await db.query(
    `insert into mkt.content_versions (org_id, content_id, version, master_body, state)
     values ($1,$2,1,$3,'DRAFT') returning id, version`,
    [ids.org, c.rows[0].id, corpo]);
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [cv.rows[0].id]);

  const ap = await db.query(
    `insert into mkt.approvals (org_id, workspace_id, subject_type, subject_id, subject_version,
                                requested_reason_codes, trace_id)
     values ($1,$2,'content_version',$3,$4,array['COMPLIANCE_REVIEW_REQUIRED'],'tr_aprov') returning id`,
    [ids.org, ids.ws, cv.rows[0].id, cv.rows[0].version]);

  return { content_version_id: cv.rows[0].id, approval_id: ap.rows[0].id };
}

const tenant = () => ({ org_id: ids.org, workspace_id: ids.ws });

beforeEach(async () => {
  await db.query(`delete from mkt.contents where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.approvals where org_id = $1`, [ids.org]);
});

test("a fila mostra o que espera decisao, com o conteudo junto", async () => {
  const { approval_id } = await conteudoEmRevisao();
  const fila = await svc.listPending(tenant());

  assert.equal(fila.length, 1);
  assert.equal(fila[0].approval.id, approval_id);
  assert.equal(fila[0].approval.decision, "PENDING");
  assert.equal(fila[0].content.state, "AI_REVIEW",
    "a tela precisa do conteudo, nao so da linha de aprovacao");
  assert.deepEqual(fila[0].approval.requested_reason_codes, ["COMPLIANCE_REVIEW_REQUIRED"]);
});

test("aprovar move o conteudo e carimba a decisao no mesmo instante", async () => {
  const { approval_id, content_version_id } = await conteudoEmRevisao();

  const r = await svc.decide({
    tenant: tenant(), approval_id, decision: "APPROVED",
    actor: { id: ids.user }, comment: "ok", trace_id: "tr_aprov",
  });

  assert.equal(r.approval.decision, "APPROVED");
  assert.equal(r.content.state, "APPROVED");
  assert.notEqual(r.content.approved_at, null);

  // decided_at e approved_at saem da mesma transacao, entao now() e o mesmo.
  // E disso que depende a comparacao exata em evaluateApproval().
  assert.equal(new Date(r.approval.decided_at).getTime(),
               new Date(r.content.approved_at).getTime(),
               "os dois carimbos precisam vir do mesmo now(), sem tolerancia");

  assert.equal(await svc.isApprovalValid(approval_id, { content_version_id }), true);
});

test("ACEITE T4 — aprovar, editar, e a aprovacao cai", async () => {
  const { approval_id, content_version_id } = await conteudoEmRevisao();

  await svc.decide({ tenant: tenant(), approval_id, decision: "APPROVED", actor: { id: ids.user } });
  assert.equal(await svc.isApprovalValid(approval_id, { content_version_id }), true,
    "antes da edicao a aprovacao tem de valer, senao o teste nao prova nada");

  // A edicao. Nenhuma outra coluna e tocada: quem reage e o trigger.
  await db.query(`update mkt.content_versions set master_body = $2 where id = $1`,
    [content_version_id, "Texto trocado depois da aprovacao."]);

  const { rows } = await db.query(
    `select state::text as state, approved_at from mkt.content_versions where id = $1`, [content_version_id]);
  assert.equal(rows[0].state, "DRAFT", "o trigger tem de derrubar o estado");
  assert.equal(rows[0].approved_at, null, "e zerar o carimbo");

  // A linha de aprovacao continua com decision='APPROVED' — ela nao foi tocada.
  const { rows: ap } = await db.query(
    `select decision::text as decision from mkt.approvals where id = $1`, [approval_id]);
  assert.equal(ap[0].decision, "APPROVED",
    "a decisao historica nao e reescrita; o que muda e ela deixar de valer");

  assert.equal(await svc.isApprovalValid(approval_id, { content_version_id }), false,
    "publicar aqui seria publicar um texto que ninguem aprovou");
});

test("a aprovacao so cai se o corpo mudou de verdade", async () => {
  const { approval_id, content_version_id } = await conteudoEmRevisao("Mesmo texto.");
  await svc.decide({ tenant: tenant(), approval_id, decision: "APPROVED", actor: { id: ids.user } });

  // Reescrever o mesmo valor nao e edicao: o trigger usa `is distinct from`.
  await db.query(`update mkt.content_versions set master_body = 'Mesmo texto.' where id = $1`,
    [content_version_id]);

  assert.equal(await svc.isApprovalValid(approval_id, { content_version_id }), true,
    "salvar sem mudar nada nao pode custar uma rodada de aprovacao");
});

test("rejeitar move para REJECTED e nao autoriza publicar", async () => {
  const { approval_id, content_version_id } = await conteudoEmRevisao();
  const r = await svc.decide({
    tenant: tenant(), approval_id, decision: "REJECTED",
    actor: { id: ids.user }, comment: "claim sem evidence",
  });

  assert.equal(r.approval.decision, "REJECTED");
  assert.equal(r.content.state, "REJECTED");
  assert.equal(r.approval.comment, "claim sem evidence");
  assert.equal(await svc.isApprovalValid(approval_id, { content_version_id }), false);
});

test("transicao ilegal derruba a decisao inteira, sem deixar meio-termo", async () => {
  const { approval_id } = await conteudoEmRevisao();
  // Volta o conteudo para DRAFT. DRAFT -> APPROVED nao existe na state machine.
  await db.query(`update mkt.content_versions set state = 'DRAFT'
                   where id = (select subject_id from mkt.approvals where id = $1)`, [approval_id]);

  await assert.rejects(
    () => svc.decide({ tenant: tenant(), approval_id, decision: "APPROVED", actor: { id: ids.user } }),
    /INVALID_STATE_TRANSITION/);

  const { rows } = await db.query(
    `select decision::text as decision, decided_at from mkt.approvals where id = $1`, [approval_id]);
  assert.equal(rows[0].decision, "PENDING",
    "sem transacao, sobraria aprovacao registrada sobre conteudo que nao mudou de estado");
  assert.equal(rows[0].decided_at, null);
});

test("reaprovar depois de editar invalida a decisao antiga e valida a nova", async () => {
  const { approval_id, content_version_id } = await conteudoEmRevisao();
  await svc.decide({ tenant: tenant(), approval_id, decision: "APPROVED", actor: { id: ids.user } });

  await db.query(`update mkt.content_versions set master_body = 'Versao revisada.' where id = $1`,
    [content_version_id]);
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [content_version_id]);

  const nova = await db.query(
    `insert into mkt.approvals (org_id, workspace_id, subject_type, subject_id, subject_version)
     values ($1,$2,'content_version',$3,1) returning id`, [ids.org, ids.ws, content_version_id]);

  await svc.decide({ tenant: tenant(), approval_id: nova.rows[0].id, decision: "APPROVED", actor: { id: ids.user } });

  assert.equal(await svc.isApprovalValid(nova.rows[0].id, { content_version_id }), true);
  assert.equal(await svc.isApprovalValid(approval_id, { content_version_id }), false,
    "a decisao das 10:00 nao pode voltar a valer sobre um texto reescrito");
});

test("aprovacao de um conteudo nao publica outro", async () => {
  const a = await conteudoEmRevisao("Conteudo A");
  const b = await conteudoEmRevisao("Conteudo B");
  await svc.decide({ tenant: tenant(), approval_id: a.approval_id, decision: "APPROVED", actor: { id: ids.user } });

  assert.equal(await svc.isApprovalValid(a.approval_id, { content_version_id: b.content_version_id }), false,
    "um approval_id valido nao pode ser um passe livre para qualquer conteudo");
});

test("evaluateApproval le a linha do banco sem traducao no meio", async () => {
  const { approval_id, content_version_id } = await conteudoEmRevisao();
  await svc.decide({ tenant: tenant(), approval_id, decision: "APPROVED", actor: { id: ids.user } });

  const par = await ports.approvals.getWithContentById(approval_id);
  const r = evaluateApproval({ ...par, expected_content_version_id: content_version_id });
  assert.equal(r.valid, true, "o formato que a porta devolve tem de ser o que a funcao pura espera");
});
