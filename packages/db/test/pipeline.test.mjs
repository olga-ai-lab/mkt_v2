/**
 * O ciclo inteiro, contra Postgres real.
 *
 * Os testes anteriores provam cada peça isolada. Este prova que elas estão
 * LIGADAS — que era exatamente o que faltava: o relay drenava um outbox que
 * nada alimentava, e a tela lia uma fila que nada criava.
 *
 * O caminho medido aqui:
 *
 *   pedir aprovação → aprovar → agendar → outbox → relay → workflow
 *   → gateway → adapter → publicado → evento de volta no outbox
 */
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { createApprovalService } from "@olga/runtime/approvals";
import { createWorkerPorts } from "../../../apps/worker/src/ports-worker.mjs";
import { createOutboxRelay, createDedupedHandler } from "../../../apps/worker/src/outbox-relay.mjs";
import { createPublishWorkflow } from "../../../apps/worker/src/publish-workflow.mjs";
import { createGateway } from "@olga/gateway";
import { createFakeMetaAdapter } from "@olga/gateway/adapters";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
const ids = {};
let ports, worker, svc;

const limpar = async () => {
  await db.query(`delete from ${""}mkt.organizations where slug = 'pipe-test'`);
  await db.query(`delete from mkt.app_users where email = 'pipe@olga.test'`);
  await db.query(`delete from mkt.processed_events where consumer = 'pipe-consumer'`);
};

before(async () => {
  await db.connect();
  await limpar();

  const u = await db.query(
    `insert into mkt.app_users (email, full_name) values ('pipe@olga.test','Pipe') returning id`);
  ids.user = u.rows[0].id;

  const r = await db.query(`
    with o as (insert into mkt.organizations (name, slug) values ('Pipe Test','pipe-test') returning id),
         w as (insert into mkt.workspaces (org_id, name) select id, 'Principal' from o returning id, org_id)
    insert into mkt.brands (org_id, workspace_id, name)
    select w.org_id, w.id, 'Marca' from w returning id, org_id, workspace_id`);
  ids.brand = r.rows[0].id;
  ids.org = r.rows[0].org_id;
  ids.ws = r.rows[0].workspace_id;

  // Brand Brain ACTIVE e conexao ACTIVE: sem os dois, a policy bloqueia antes
  // de chegar no adapter — e o teste mediria o bloqueio, nao o caminho.
  await db.query(
    `insert into mkt.brand_brain_versions (org_id, brand_id, version, status)
     values ($1,$2,1,'ACTIVE')`, [ids.org, ids.brand]);

  const conn = await db.query(
    `insert into mkt.connections (org_id, workspace_id, channel, provider, external_account_id, status)
     values ($1,$2,'INSTAGRAM','meta','17841400000000000','ACTIVE') returning id`, [ids.org, ids.ws]);
  ids.conn = conn.rows[0].id;

  ports = createPostgresPorts(db, { schema: "mkt" });
  worker = createWorkerPorts(db, { schema: "mkt" });
  svc = createApprovalService({ approvals: ports.approvals });
});

after(async () => { await limpar(); await db.end(); });

beforeEach(async () => {
  // A ordem importa: action_receipts.approval_id referencia approvals SEM
  // cascade, de proposito — nao se apaga a aprovacao que autorizou um efeito
  // que ja aconteceu. Entao o receipt sai primeiro.
  await db.query(`delete from mkt.outbox where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.action_receipts where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.publications where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.contents where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.approvals where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.workflow_runs where org_id = $1`, [ids.org]);
  await db.query(`delete from mkt.processed_events where consumer = 'pipe-consumer'`);
});

/** Conteudo em DRAFT com uma variante de canal. */
async function conteudo({ material = false, claim_type = "GENERAL" } = {}) {
  const c = await db.query(
    `insert into mkt.contents (org_id, workspace_id, brand_id, title)
     values ($1,$2,$3,'Post') returning id`, [ids.org, ids.ws, ids.brand]);
  const cv = await db.query(
    `insert into mkt.content_versions (org_id, content_id, version, master_body, state)
     values ($1,$2,1,'Texto do post.','DRAFT') returning id`, [ids.org, c.rows[0].id]);
  const variante = await db.query(
    `insert into mkt.channel_variants (org_id, content_version_id, channel, body, asset_refs)
     values ($1,$2,'INSTAGRAM','Corpo da variante.','[{"url":"https://cdn.olga.test/a.jpg"}]'::jsonb)
     returning id`, [ids.org, cv.rows[0].id]);

  if (material) {
    const ev = await db.query(
      `insert into mkt.evidence (org_id, workspace_id, source_kind, locator, hash)
       values ($1,$2,'BRAND_BRAIN','brand://1','h1') returning id`, [ids.org, ids.ws]);
    await db.query(
      `insert into mkt.claims (org_id, content_version_id, text, material, claim_type, evidence_ids)
       values ($1,$2,'Cobre alagamento.',true,$3,array[$4::uuid])`,
      [ids.org, cv.rows[0].id, claim_type, ev.rows[0].id]);
  }
  return { content_version_id: cv.rows[0].id, channel_variant_id: variante.rows[0].id };
}

/**
 * O evento DESTE conteudo, entre os que o relay entregou.
 *
 * O relay drena o outbox inteiro, como em producao. Pegar `entregues[0]` supunha
 * um mundo vazio — e quando outro arquivo de teste agendava algo em paralelo, o
 * teste consumia o evento do vizinho e falhava por um motivo que nao era o dele.
 */
const meuEvento = (p, content_version_id) => {
  const e = p.entregues.find((x) => x.data?.content_version_id === content_version_id);
  if (!e) throw new Error(`o relay nao entregou o evento de ${content_version_id}`);
  return e;
};

const durableStep = (memo = {}) => ({
  run: async (name, fn) => {
    if (name in memo) return memo[name];
    const out = await fn();
    memo[name] = out;
    return out;
  },
});

/** Monta relay + handler ligados ao banco de verdade. */
function pipeline() {
  const adapter = createFakeMetaAdapter({ idPrefix: "ig" });
  const gateway = createGateway({
    registry: {
      getCapability: (id, v) => worker.getCapability(id, v),
      newId: () => crypto.randomUUID(),
      isApprovalValid: (id, args) => svc.isApprovalValid(id, args),
    },
    policies: ports.policies,
    receipts: ports.receipts,
    adapters: { meta_graph: adapter },
  });

  const dbPorts = { ...worker, ...ports.outbox };
  const handler = createDedupedHandler({
    db: dbPorts, consumer: "pipe-consumer",
    handler: createPublishWorkflow({ gateway, db: dbPorts }),
  });

  const entregues = [];
  const relay = createOutboxRelay({ db: dbPorts, bus: { send: async (e) => entregues.push(e) } });
  return { adapter, relay, handler, entregues };
}

// ── Os produtores ───────────────────────────────────────────────────────────

test("pedir aprovacao cria a linha e leva o conteudo para revisao", async () => {
  const { content_version_id } = await conteudo();
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [content_version_id]);

  const r = await ports.publishing.requestApproval({
    org_id: ids.org, workspace_id: ids.ws, content_version_id,
    reason_codes: ["WORKSPACE_FIRST_PUBLISH"], trace_id: "tr_ap",
  });

  assert.equal(r.state, "HUMAN_REVIEW");
  const fila = await svc.listPending({ org_id: ids.org, workspace_id: ids.ws });
  assert.equal(fila.length, 1, "a tela de aprovacao agora tem de onde ler");
  assert.equal(fila[0].content.state, "HUMAN_REVIEW");
});

test("claim de compliance vai para COMPLIANCE_REVIEW, nao para a fila comum", async () => {
  const { content_version_id } = await conteudo();
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [content_version_id]);

  const r = await ports.publishing.requestApproval({
    org_id: ids.org, workspace_id: ids.ws, content_version_id,
    reason_codes: ["COMPLIANCE_REVIEW_REQUIRED"],
  });
  assert.equal(r.state, "COMPLIANCE_REVIEW",
    "quem escolhe o destino sao os reason codes, nao quem chama");
});

test("agendar sem aprovacao nao escreve nada — nem publicacao, nem evento", async () => {
  const { content_version_id, channel_variant_id } = await conteudo();

  await assert.rejects(
    () => ports.publishing.schedule({
      org_id: ids.org, workspace_id: ids.ws, content_version_id,
      channel: "INSTAGRAM", connection_id: ids.conn, channel_variant_id,
    }),
    (e) => e.reason_code === "CONTENT_NOT_APPROVED");

  const pubs = await db.query(`select count(*)::int n from mkt.publications where org_id = $1`, [ids.org]);
  const out = await db.query(`select count(*)::int n from mkt.outbox where org_id = $1`, [ids.org]);
  assert.equal(pubs.rows[0].n, 0);
  assert.equal(out.rows[0].n, 0, "evento sem mudanca de estado e o que o outbox existe para impedir");
});

// ── Os fatos que a policy avalia ────────────────────────────────────────────

test("collectPublishFacts reduz o banco aos nomes do enum de fatos", async () => {
  const { content_version_id } = await conteudo({ material: true, claim_type: "COVERAGE" });
  const f = await worker.collectPublishFacts({
    content_version_id, connection_id: ids.conn, workspace_id: ids.ws,
  });

  assert.equal(f.channel_connected, true);
  assert.equal(f.content_status, "DRAFT");
  assert.equal(f.brand_brain_status, "ACTIVE");
  assert.equal(f.evidence_coverage, true, "claim material COM evidence cobre");
  assert.equal(f.workspace_first_publish, true, "nada publicado ainda neste workspace");
  assert.deepEqual(f.claim_types, ["COVERAGE"]);
});

test("conexao inexistente e conexao desconectada, nao fato nulo", async () => {
  const { content_version_id } = await conteudo();
  const f = await worker.collectPublishFacts({
    content_version_id, connection_id: "00000000-0000-4000-8000-000000000000", workspace_id: ids.ws,
  });
  assert.equal(f.channel_connected, false,
    "NULL vazando para o engine viraria decisao sobre fato que ninguem afirmou");
});

test("sem claim material, a cobertura de evidence e verdadeira", async () => {
  const { content_version_id } = await conteudo({ material: false });
  const f = await worker.collectPublishFacts({
    content_version_id, connection_id: ids.conn, workspace_id: ids.ws,
  });
  assert.equal(f.evidence_coverage, true);
  assert.deepEqual(f.claim_types, []);
});

// ── O ciclo fechado ─────────────────────────────────────────────────────────

test("ACEITE — aprovar, agendar e publicar, do inicio ao fim", async () => {
  const { content_version_id, channel_variant_id } = await conteudo();
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [content_version_id]);

  // 1. Policy pediu humano. O produtor cria o pedido.
  const { approval_id } = await ports.publishing.requestApproval({
    org_id: ids.org, workspace_id: ids.ws, content_version_id,
    reason_codes: ["WORKSPACE_FIRST_PUBLISH"], trace_id: "tr_e2e",
  });

  // 2. Alguem aprova pela tela.
  await svc.decide({
    tenant: { org_id: ids.org, workspace_id: ids.ws },
    approval_id, decision: "APPROVED", actor: { id: ids.user },
  });

  // 3. Agendar: estado e evento no mesmo commit.
  const ag = await ports.publishing.schedule({
    org_id: ids.org, workspace_id: ids.ws, content_version_id,
    channel: "INSTAGRAM", connection_id: ids.conn, channel_variant_id,
    approval_id, trace_id: "tr_e2e", autonomy_used: "A3",
  });
  assert.ok(ag.outbox_id, "agendar tem de deixar o pedido no outbox");

  // 4. O relay drena.
  //
  // Ele drena o outbox INTEIRO, como em producao — e por isso este teste
  // procura o proprio evento em vez de exigir que o mundo esteja vazio. Exigir
  // `sent.length === 1` fazia esta asserção falhar quando outro arquivo de
  // teste agendava algo em paralelo: o que quebrava era a suposicao do teste, e
  // nao o pipeline.
  const p = pipeline();
  const r = await p.relay();
  assert.ok(r.sent.length >= 1, "o relay tem de entregar o que estava no outbox");

  const meu = meuEvento(p, content_version_id);
  assert.equal(meu.name, "olga/content.publish.requested");

  // 5. O workflow consome e publica.
  const data = { ...meu.data, trace_id: "tr_e2e", requested_autonomy: "A3",
                 approval_id, actor: { role: "OWNER", org_id: ids.org } };
  const out = await p.handler(data, durableStep());

  assert.equal(out.status, "SUCCEEDED", `esperava publicar, veio ${out.status}`);
  assert.equal(p.adapter.calls.length, 1, "o adapter tem de ser chamado uma vez");

  // 6. O dominio reflete, e o evento de volta esta no outbox.
  const cv = await db.query(`select state::text as state from mkt.content_versions where id = $1`,
    [content_version_id]);
  assert.equal(cv.rows[0].state, "PUBLISHED");

  const pub = await db.query(
    `select status::text as status, external_id from mkt.publications where content_version_id = $1`,
    [content_version_id]);
  assert.equal(pub.rows[0].status, "PUBLISHED");
  assert.ok(pub.rows[0].external_id, "o external_id do provider tem de chegar no dominio");

  const ev = await db.query(
    `select event_type from mkt.outbox where org_id = $1 and event_type = 'olga/content.published'`,
    [ids.org]);
  assert.equal(ev.rows.length, 1, "publicar tem de emitir evento, no mesmo commit do estado");
});

test("ACEITE — reentrega do mesmo pedido nao publica duas vezes", async () => {
  const { content_version_id, channel_variant_id } = await conteudo();
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [content_version_id]);
  const { approval_id } = await ports.publishing.requestApproval({
    org_id: ids.org, workspace_id: ids.ws, content_version_id, reason_codes: [],
  });
  await svc.decide({ tenant: { org_id: ids.org, workspace_id: ids.ws },
                     approval_id, decision: "APPROVED", actor: { id: ids.user } });
  await ports.publishing.schedule({
    org_id: ids.org, workspace_id: ids.ws, content_version_id,
    channel: "INSTAGRAM", connection_id: ids.conn, channel_variant_id, approval_id, trace_id: "tr_dup",
  });

  const p = pipeline();
  await p.relay();
  const data = { ...meuEvento(p, content_version_id).data, trace_id: "tr_dup",
                 requested_autonomy: "A3", approval_id,
                 actor: { role: "OWNER", org_id: ids.org } };

  await p.handler(data, durableStep());
  const segunda = await p.handler(data, durableStep());

  assert.equal(segunda.deduplicated, true);
  assert.equal(p.adapter.calls.length, 1, "o provider foi chamado duas vezes — post duplicado");

  const eventos = await db.query(
    `select count(*)::int n from mkt.outbox where org_id = $1 and event_type = 'olga/content.published'`,
    [ids.org]);
  assert.equal(eventos.rows[0].n, 1, "avisar duas vezes e o mesmo problema, um andar acima");
});

test("conteudo editado depois de aprovado nao chega a publicar", async () => {
  const { content_version_id, channel_variant_id } = await conteudo();
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [content_version_id]);
  const { approval_id } = await ports.publishing.requestApproval({
    org_id: ids.org, workspace_id: ids.ws, content_version_id, reason_codes: [],
  });
  await svc.decide({ tenant: { org_id: ids.org, workspace_id: ids.ws },
                     approval_id, decision: "APPROVED", actor: { id: ids.user } });

  // A edicao. O trigger derruba para DRAFT.
  await db.query(`update mkt.content_versions set master_body = 'Outro texto.' where id = $1`,
    [content_version_id]);

  await assert.rejects(
    () => ports.publishing.schedule({
      org_id: ids.org, workspace_id: ids.ws, content_version_id,
      channel: "INSTAGRAM", connection_id: ids.conn, channel_variant_id, approval_id,
    }),
    (e) => e.reason_code === "CONTENT_NOT_APPROVED",
    "a edicao tem de barrar o agendamento, nao so a publicacao");
});

// ── Leitura para as telas ───────────────────────────────────────────────────

test("a listagem traz a versao corrente, com variantes e publicacoes", async () => {
  const { content_version_id } = await conteudo();
  const lista = await ports.content.listByWorkspace(ids.org, ids.ws);

  assert.equal(lista.length, 1);
  assert.equal(lista[0].content_version_id, content_version_id);
  assert.equal(lista[0].state, "DRAFT");
  assert.equal(lista[0].variants.length, 1, "a tela precisa saber que ha variante para publicar");
  assert.equal(lista[0].variants[0].channel, "INSTAGRAM");
  assert.deepEqual(lista[0].publications, [], "sem publicacao ainda");
});

test("a listagem mostra so a versao mais recente de cada conteudo", async () => {
  const c = await db.query(
    `insert into mkt.contents (org_id, workspace_id, brand_id, title)
     values ($1,$2,$3,'Multi') returning id`, [ids.org, ids.ws, ids.brand]);
  for (const v of [1, 2, 3]) {
    await db.query(
      `insert into mkt.content_versions (org_id, content_id, version, master_body, state)
       values ($1,$2,$3::int,'v' || $3::text,'DRAFT')`, [ids.org, c.rows[0].id, v]);
  }

  const lista = await ports.content.listByWorkspace(ids.org, ids.ws);
  const linha = lista.find((x) => x.content_id === c.rows[0].id);
  assert.equal(lista.filter((x) => x.content_id === c.rows[0].id).length, 1,
    "uma linha por conteudo, nao uma por versao");
  assert.equal(linha.version, 3);
});

test("a listagem nao atravessa workspace", async () => {
  await conteudo();
  const vazio = await ports.content.listByWorkspace(ids.org, "00000000-0000-4000-8000-000000000000");
  assert.deepEqual(vazio, []);
});

test("as conexoes do workspace saem com status legivel", async () => {
  const conns = await ports.content.listConnections(ids.org, ids.ws);
  assert.equal(conns.length, 1);
  assert.equal(conns[0].channel, "INSTAGRAM");
  assert.equal(conns[0].status, "ACTIVE");
});

test("depois de publicar, a listagem mostra o canal publicado", async () => {
  const { content_version_id, channel_variant_id } = await conteudo();
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [content_version_id]);
  const { approval_id } = await ports.publishing.requestApproval({
    org_id: ids.org, workspace_id: ids.ws, content_version_id, reason_codes: [],
  });
  await svc.decide({ tenant: { org_id: ids.org, workspace_id: ids.ws },
                     approval_id, decision: "APPROVED", actor: { id: ids.user } });
  await ports.publishing.schedule({
    org_id: ids.org, workspace_id: ids.ws, content_version_id,
    channel: "INSTAGRAM", connection_id: ids.conn, channel_variant_id, approval_id, trace_id: "tr_lista",
  });

  const p = pipeline();
  await p.relay();
  await p.handler({ ...meuEvento(p, content_version_id).data, trace_id: "tr_lista",
                    requested_autonomy: "A3", approval_id,
                    actor: { role: "OWNER", org_id: ids.org } }, durableStep());

  const lista = await ports.content.listByWorkspace(ids.org, ids.ws);
  const linha = lista.find((x) => x.content_version_id === content_version_id);
  assert.equal(linha.state, "PUBLISHED");
  assert.equal(linha.publications[0].status, "PUBLISHED");
  assert.ok(linha.publications[0].external_id);
});

// ── Critérios do Gate G1 (MKT-17, Fase 1) ───────────────────────────────────

test("G1 — receipt carrega o external ID do provider, e o trace liga pedido a efeito", async () => {
  // O MKT-17 pede, para fechar a Fase 1: "receipt com external ID do provider;
  // trace completo do pedido ao efeito". Aqui os dois são medidos numa
  // passagem só, porque é assim que eles importam: um trace que não chega até
  // o receipt não prova nada, e um receipt sem external_id não prova efeito.
  const trace = `tr_g1_${Date.now()}`;
  const { content_version_id, channel_variant_id } = await conteudo();
  await db.query(`update mkt.content_versions set state = 'AI_REVIEW' where id = $1`, [content_version_id]);

  const { approval_id } = await ports.publishing.requestApproval({
    org_id: ids.org, workspace_id: ids.ws, content_version_id,
    reason_codes: ["WORKSPACE_FIRST_PUBLISH"], trace_id: trace,
  });
  await svc.decide({ tenant: { org_id: ids.org, workspace_id: ids.ws },
                     approval_id, decision: "APPROVED", actor: { id: ids.user }, trace_id: trace });
  await ports.publishing.schedule({
    org_id: ids.org, workspace_id: ids.ws, content_version_id,
    channel: "INSTAGRAM", connection_id: ids.conn, channel_variant_id,
    approval_id, trace_id: trace, autonomy_used: "A3",
  });

  const p = pipeline();
  await p.relay();
  const out = await p.handler(
    { ...meuEvento(p, content_version_id).data, trace_id: trace, requested_autonomy: "A3",
      approval_id, actor: { role: "OWNER", org_id: ids.org } },
    durableStep());
  assert.equal(out.status, "SUCCEEDED");

  // 1. O receipt existe e carrega o id que o PROVIDER devolveu — não um id nosso.
  const receipt = await db.query(
    `select external_id, trace_id, provider, status::text as status, approval_id
       from mkt.action_receipts where trace_id = $1`, [trace]);
  assert.equal(receipt.rows.length, 1, "um efeito externo, um receipt");
  assert.equal(receipt.rows[0].external_id, p.adapter.calls.length ? "ig_1" : null,
    "o external_id tem de ser o que o adapter devolveu");
  assert.equal(receipt.rows[0].status, "EFFECTED");
  assert.equal(receipt.rows[0].approval_id, approval_id,
    "o receipt aponta para a aprovacao que autorizou");

  // 2. O MESMO trace liga as quatro pontas: pedido, execucao, efeito e aviso.
  const [pedido, run, aviso] = await Promise.all([
    db.query(`select 1 from mkt.outbox
               where trace_id = $1 and event_type = 'olga/content.publish.requested'`, [trace]),
    db.query(`select current_state from mkt.workflow_runs where trace_id = $1`, [trace]),
    db.query(`select 1 from mkt.outbox
               where trace_id = $1 and event_type = 'olga/content.published'`, [trace]),
  ]);

  assert.equal(pedido.rows.length, 1, "o pedido tem de estar no trace");
  assert.equal(run.rows.length, 1, "a execucao tem de estar no trace");
  assert.equal(run.rows[0].current_state, "PUBLISHED");
  assert.equal(aviso.rows.length, 1, "o aviso de publicado tem de estar no trace");

  // Sem isto, "trace completo" seria uma coluna preenchida em lugares soltos.
  // Com isto, uma auditoria parte do pedido e chega ao id do post.
});
