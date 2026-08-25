import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateApproval, createApprovalService } from "../src/approvals.mjs";

const CV = "33333333-3333-3333-3333-333333333333";
const T0 = "2026-08-25T10:00:00.000Z";
const T1 = "2026-08-25T12:00:00.000Z";

const aprovacao = (p = {}) => ({
  id: "ap1", subject_type: "content_version", subject_id: CV, subject_version: 3,
  decision: "APPROVED", decided_at: T0, ...p,
});
const conteudo = (p = {}) => ({
  id: CV, version: 3, state: "APPROVED", approved_at: T0, master_body: "texto", ...p,
});

test("aprovacao coerente autoriza a publicacao", () => {
  const r = evaluateApproval({ approval: aprovacao(), content: conteudo() });
  assert.equal(r.valid, true);
  assert.equal(r.reason_code, null);
});

test("ACEITE T4 — editar depois de aprovado derruba a aprovacao", () => {
  // Exatamente o que o trigger mkt.invalidate_approval_on_edit() deixa para
  // tras: state volta para DRAFT e approved_at e zerado. A linha de aprovacao
  // segue intacta, com decision='APPROVED' — e mesmo assim nao pode valer.
  const r = evaluateApproval({
    approval: aprovacao(),
    content: conteudo({ state: "DRAFT", approved_at: null }),
  });
  assert.equal(r.valid, false);
  assert.equal(r.reason_code, "CONTENT_NOT_APPROVED");
});

test("reaprovacao posterior invalida a decisao antiga", () => {
  // O conteudo foi editado e aprovado DE NOVO as 12:00. A decisao das 10:00
  // aponta para o mesmo id e a mesma versao, e o estado voltou a APPROVED —
  // sem esta regra, ela autorizaria um texto que aquele aprovador nunca leu.
  const r = evaluateApproval({
    approval: aprovacao({ decided_at: T0 }),
    content: conteudo({ approved_at: T1 }),
  });
  assert.equal(r.valid, false);
  assert.match(r.detail, /aprovado de novo/);
});

test("a aprovacao mais recente vale", () => {
  const r = evaluateApproval({
    approval: aprovacao({ decided_at: T1 }),
    content: conteudo({ approved_at: T1 }),
  });
  assert.equal(r.valid, true);
});

test("aprovacao de outro conteudo nao publica este", () => {
  const r = evaluateApproval({
    approval: aprovacao(),
    content: conteudo(),
    expected_content_version_id: "99999999-9999-9999-9999-999999999999",
  });
  assert.equal(r.valid, false);
  assert.match(r.detail, /outro conteudo/);
});

test("PENDING e REJECTED nao autorizam", () => {
  for (const d of ["PENDING", "REJECTED", "EXPIRED"]) {
    const r = evaluateApproval({ approval: aprovacao({ decision: d }), content: conteudo() });
    assert.equal(r.valid, false, `${d} nao pode autorizar`);
  }
});

test("numero de versao trocado debaixo da aprovacao recusa", () => {
  const r = evaluateApproval({ approval: aprovacao({ subject_version: 3 }), content: conteudo({ version: 4 }) });
  assert.equal(r.valid, false);
  assert.match(r.detail, /versao/);
});

test("subject_type errado e erro de integracao, nao fluxo editorial", () => {
  const r = evaluateApproval({ approval: aprovacao({ subject_type: "campaign" }), content: conteudo() });
  assert.equal(r.reason_code, "SCHEMA_VALIDATION_FAILED",
    "reportar isso como CONTENT_NOT_APPROVED esconderia bug atras de mensagem de produto");
});

test("SCHEDULED e PUBLISHED continuam cobertos", () => {
  for (const s of ["SCHEDULED", "PUBLISHING", "PUBLISHED"]) {
    const r = evaluateApproval({ approval: aprovacao(), content: conteudo({ state: s }) });
    assert.equal(r.valid, true, `${s} tem de continuar coberto`);
  }
});

test("replay depois de publicado nao vira bloqueio de policy", () => {
  // O gateway checa aprovacao ANTES da deduplicacao. Se PUBLISHED invalidasse
  // a aprovacao, o replay do workflow devolveria BLOCKED em vez de
  // DEDUPLICATED — e o Gate G1 cairia por causa desta camada.
  const r = evaluateApproval({ approval: aprovacao(), content: conteudo({ state: "PUBLISHED" }) });
  assert.equal(r.valid, true);
});

// ── Servico ────────────────────────────────────────────────────────────────

function servicoFalso({ par, decidido } = {}) {
  const chamadas = [];
  const approvals = {
    listPending: async () => [par],
    getWithContent: async () => par,
    getWithContentById: async () => par,
    decide: async (args) => { chamadas.push(args); return decidido ?? par; },
  };
  return { svc: createApprovalService({ approvals, audit: { record: async () => {} } }), chamadas };
}

test("decidir duas vezes nao sobrescreve a decisao de quem chegou antes", async () => {
  const par = { approval: aprovacao({ decision: "APPROVED" }), content: conteudo() };
  const { svc, chamadas } = servicoFalso({ par });

  const r = await svc.decide({
    tenant: { org_id: "o", workspace_id: "w" }, approval_id: "ap1",
    decision: "REJECTED", actor: { id: "u2" },
  });

  assert.equal(r.already_decided, true);
  assert.equal(chamadas.length, 0, "duas abas abertas nao podem virar sobrescrita silenciosa");
});

test("decisao fora do enum e recusada antes de tocar no banco", async () => {
  const par = { approval: aprovacao({ decision: "PENDING" }), content: conteudo() };
  const { svc, chamadas } = servicoFalso({ par });
  await assert.rejects(
    () => svc.decide({ tenant: {}, approval_id: "ap1", decision: "TALVEZ", actor: { id: "u" } }),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED");
  assert.equal(chamadas.length, 0);
});

test("isApprovalValid tem a assinatura que o gateway chama", async () => {
  const par = { approval: aprovacao(), content: conteudo() };
  const { svc } = servicoFalso({ par });
  assert.equal(await svc.isApprovalValid("ap1", { content_version_id: CV }), true);
  assert.equal(await svc.isApprovalValid("ap1", { content_version_id: "outro" }), false);
});
