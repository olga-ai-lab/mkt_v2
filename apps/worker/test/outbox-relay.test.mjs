import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutboxRelay, createDedupedHandler, outboxEventKey } from "../src/outbox-relay.mjs";
import { createPublishWorkflow } from "../src/publish-workflow.mjs";
import { createGateway } from "@olga/gateway";

const ORG = "11111111-1111-1111-1111-111111111111";
const WS = "22222222-2222-2222-2222-222222222222";

const CAP = {
  capability_id: "publishing.publish", version: 1, status: "ACTIVE", mode: "write",
  side_effect: "external", risk_tier: "MEDIUM", permissions: ["OWNER", "MARKETING"],
  provider_adapter: "meta_graph", max_attempts: 1,
  idempotency: { required: true, key_template: "{workspace_id}:{content_version_id}:{channel}:{connection_id}" },
};
const POL = {
  policy_id: "POL_PUBLISH", version: 1, status: "ACTIVE", priority: 500,
  scope: { capability_id: "publishing.publish" },
  conditions: [{ fact: "channel_connected", op: "is_true", value: true }],
  effect: "ALLOW", max_autonomy: "A3",
};

/** Outbox em memoria com a mesma semantica do claim SQL (skip locked + attempts). */
function fakeOutbox(rows = []) {
  const table = rows.map((r, i) => ({
    id: i + 1, org_id: ORG, workspace_id: WS, trace_id: `tr_${i + 1}`,
    published_at: null, attempts: 0, occurred_at: new Date().toISOString(), ...r,
  }));
  const processed = new Set();

  return {
    table, processed,
    async claimOutboxBatch(limit = 100, maxAttempts = 5) {
      const claimed = table
        .filter((r) => r.published_at === null && r.attempts < maxAttempts)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
      for (const r of claimed) r.attempts++;
      return claimed.map((r) => ({ ...r }));
    },
    async markOutboxPublished(id) {
      const r = table.find((x) => x.id === id);
      if (r && r.published_at === null) r.published_at = new Date().toISOString();
    },
    async listStuckOutbox(maxAttempts = 5) {
      return table.filter((r) => r.published_at === null && r.attempts >= maxAttempts);
    },
    async wasProcessed(consumer, key) { return processed.has(`${consumer}|${key}`); },
    async markProcessed(consumer, key) { processed.add(`${consumer}|${key}`); },
  };
}

function durableStep(memo = {}) {
  return {
    memo,
    run: async (name, fn) => {
      if (name in memo) return memo[name];
      const out = await fn();
      memo[name] = out;
      return out;
    },
  };
}

// ── Relay ───────────────────────────────────────────────────────────────────

test("drena o outbox, entrega ao barramento e marca published_at", async () => {
  const db = fakeOutbox([
    { event_type: "olga/content.publish.requested", payload: { content_version_id: "cv1" } },
    { event_type: "olga/content.publish.requested", payload: { content_version_id: "cv2" } },
  ]);
  const enviados = [];
  const relay = createOutboxRelay({ db, bus: { send: async (e) => enviados.push(e) } });

  const r = await relay();

  assert.equal(r.claimed, 2);
  assert.equal(r.sent.length, 2);
  assert.equal(enviados.length, 2);
  assert.ok(db.table.every((x) => x.published_at !== null), "linha entregue tem de sair da fila");

  // Segunda passada nao acha mais nada: published_at e o que tira da fila.
  const vazio = await relay();
  assert.equal(vazio.claimed, 0);
  assert.equal(enviados.length, 2);
});

test("o evento entregue carrega outbox_id — sem identidade nao ha dedup possivel", async () => {
  const db = fakeOutbox([{ event_type: "olga/x", payload: { content_version_id: "cv1" } }]);
  const enviados = [];
  await createOutboxRelay({ db, bus: { send: async (e) => enviados.push(e) } })();

  assert.equal(enviados[0].data.outbox_id, "1");
  assert.equal(enviados[0].data.org_id, ORG);
  assert.equal(enviados[0].data.content_version_id, "cv1", "o payload de dominio segue intacto");
});

test("falha no envio nao marca published_at: a linha volta na proxima passada", async () => {
  const db = fakeOutbox([{ event_type: "olga/x", payload: {} }]);
  let cair = true;
  const relay = createOutboxRelay({
    db, bus: { send: async () => { if (cair) throw new Error("BUS_DOWN"); } },
  });

  const r1 = await relay();
  assert.equal(r1.sent.length, 0);
  assert.equal(r1.failed.length, 1);
  assert.equal(db.table[0].published_at, null, "nao publicado nao pode sair da fila");
  assert.equal(db.table[0].attempts, 1, "a tentativa tem de ser contada");

  cair = false;
  const r2 = await relay();
  assert.equal(r2.sent.length, 1);
  assert.notEqual(db.table[0].published_at, null);
});

test("linha envenenada para de ser tentada e nao segura a fila", async () => {
  const db = fakeOutbox([
    { event_type: "olga/veneno", payload: {}, attempts: 5 },
    { event_type: "olga/boa", payload: {} },
  ]);
  const enviados = [];
  const r = await createOutboxRelay({
    db, bus: { send: async (e) => enviados.push(e) }, maxAttempts: 5,
  })();

  assert.equal(r.claimed, 1, "a envenenada nao pode mais ser reclamada");
  assert.equal(enviados[0].data.outbox_id, "2", "a boa passou na frente");
  assert.equal((await db.listStuckOutbox(5)).length, 1, "e continua visivel como travada");
});

// ── Guarda de consumo ───────────────────────────────────────────────────────

test("evento sem outbox_id e recusado em vez de processado as cegas", () => {
  assert.throws(() => outboxEventKey({ content_version_id: "cv1" }), /outbox_id/);
});

test("reentrega do mesmo evento nao roda o handler de novo", async () => {
  const db = fakeOutbox();
  let execucoes = 0;
  const handler = createDedupedHandler({
    db, consumer: "publish-content",
    handler: async () => { execucoes++; return { status: "SUCCEEDED" }; },
  });

  const data = { outbox_id: "7", trace_id: "tr_7" };
  const a = await handler(data, durableStep());
  const b = await handler(data, durableStep());

  assert.equal(a.deduplicated, false);
  assert.equal(b.deduplicated, true);
  assert.equal(b.status, "DEDUPLICATED");
  assert.equal(execucoes, 1);
});

test("handler que falha NAO marca processado — o evento nao pode sumir", async () => {
  const db = fakeOutbox();
  let execucoes = 0;
  const handler = createDedupedHandler({
    db, consumer: "publish-content",
    handler: async () => { execucoes++; if (execucoes === 1) throw new Error("QUEDA"); return { status: "SUCCEEDED" }; },
  });
  const data = { outbox_id: "9", trace_id: "tr_9" };

  await assert.rejects(() => handler(data, durableStep()), /QUEDA/);
  assert.equal(db.processed.size, 0, "marcar antes do sucesso perderia o evento");

  const r = await handler(data, durableStep());
  assert.equal(r.deduplicated, false, "a reentrega tem de processar de verdade");
  assert.equal(execucoes, 2);
});

// ── Aceite do T5 ────────────────────────────────────────────────────────────

/** Monta o caminho inteiro: outbox → relay → barramento → workflow → gateway. */
function pipelineCompleto() {
  const adapterCalls = [];
  const receiptsStore = [];
  const domain = { published: [], blocked: [], failed: [], runs: {} };
  let seq = 0;

  const gateway = createGateway({
    registry: {
      getCapability: async () => CAP,
      newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    },
    policies: { listActive: async () => [POL] },
    receipts: {
      find: async (o, c, k) => receiptsStore.find((r) => r.idempotency_key === k) ?? null,
      save: async (r) => { receiptsStore.push(r); },
    },
    adapters: {
      meta_graph: {
        call: async ({ idempotency_key }) => {
          adapterCalls.push(idempotency_key);
          return { external_id: `ig_${adapterCalls.length}` };
        },
      },
    },
  });

  const outbox = fakeOutbox([{
    event_type: "olga/content.publish.requested",
    payload: {
      content_version_id: "cv1", channel: "INSTAGRAM", connection_id: "conn1",
      channel_variant_id: "var1", requested_autonomy: "A3",
      actor: { role: "OWNER", org_id: ORG },
    },
  }]);

  const db = {
    ...outbox,
    getCapability: async () => CAP,
    collectPublishFacts: async () => ({
      channel_connected: true, content_status: "APPROVED", brand_brain_status: "ACTIVE",
      evidence_coverage: true, workspace_first_publish: false, claim_types: ["GENERAL"],
    }),
    upsertWorkflowRun: async (r) => { domain.runs[r.trace_id] = { ...r }; },
    updateWorkflowRun: async (t, patch) => { domain.runs[t] = { ...(domain.runs[t] ?? {}), ...patch }; },
    markPublished: async (p) => { domain.published.push(p); },
    markBlocked: async (p) => { domain.blocked.push(p); },
    markFailed: async (p) => { domain.failed.push(p); },
  };

  const handler = createDedupedHandler({
    db, consumer: "publish-content",
    handler: createPublishWorkflow({ gateway, db }),
  });

  const entregues = [];
  const relay = createOutboxRelay({ db, bus: { send: async (e) => entregues.push(e) } });

  return { db, outbox, relay, handler, entregues, adapterCalls, receiptsStore, domain };
}

test("T5 — o caminho inteiro publica uma vez", async () => {
  const p = pipelineCompleto();
  await p.relay();
  assert.equal(p.entregues.length, 1);

  const r = await p.handler(p.entregues[0].data, durableStep());
  assert.equal(r.status, "SUCCEEDED");
  assert.equal(p.adapterCalls.length, 1);
  assert.equal(p.domain.published.length, 1);
});

test("T5 ACEITE — entrega duplicada do mesmo evento do outbox nao publica duas vezes", async () => {
  const p = pipelineCompleto();
  await p.relay();
  const data = p.entregues[0].data;

  // A guarda pega a segunda passagem.
  await p.handler(data, durableStep());
  const segunda = await p.handler(data, durableStep());

  assert.equal(segunda.deduplicated, true);
  assert.equal(p.adapterCalls.length, 1, "o provider foi chamado duas vezes — post duplicado");
  assert.equal(p.receiptsStore.length, 1);
});

test("T5 ACEITE — queda na janela entre publicar e marcar consumido nao duplica o post", async () => {
  const p = pipelineCompleto();
  await p.relay();
  const data = p.entregues[0].data;

  // Esta e a janela real: o handler ja teve sucesso (o post SAIU), o processo
  // cai antes de gravar processed_events. O motor durável reentrega, e a guarda
  // de consumo nao tem como saber que o efeito ja aconteceu.
  const memo = {};
  const stepQueQuebraNoMark = {
    run: async (name, fn) => {
      if (name in memo) return memo[name];
      if (name === "dedup-mark") throw new Error("QUEDA_ANTES_DE_MARCAR");
      const out = await fn();
      memo[name] = out;
      return out;
    },
  };

  await assert.rejects(() => p.handler(data, stepQueQuebraNoMark), /QUEDA_ANTES_DE_MARCAR/);
  assert.equal(p.adapterCalls.length, 1, "o post saiu na primeira passagem");
  assert.equal(p.db.processed.size, 0, "e nao ficou registrado como consumido");

  // Reentrega, do zero, sem memo: a guarda deixa passar (nao ha registro),
  // o workflow roda inteiro de novo — e o Capability Gateway segura o efeito.
  // E aqui que se ve onde a idempotencia realmente mora.
  const r = await p.handler(data, durableStep());

  assert.equal(r.deduplicated, false, "a guarda nao tinha como deduplicar, e esta certo");
  assert.equal(r.status, "DEDUPLICATED", "quem deduplicou foi o gateway, uma camada abaixo");
  assert.equal(p.adapterCalls.length, 1, "post duplicado: o efeito externo saiu duas vezes");
  assert.equal(p.receiptsStore.length, 1, "dois receipts para o mesmo efeito");
});
