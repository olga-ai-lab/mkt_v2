import { test } from "node:test";
import assert from "node:assert/strict";
import { createModelGateway, estimateCostCents } from "../src/model-gateway.mjs";

const TENANT = { org_id: "11111111-1111-1111-1111-111111111111", workspace_id: "22222222-2222-2222-2222-222222222222" };
const PRICE = { input_cents_per_mtok: 300, output_cents_per_mtok: 1500 };

const ROUTE = {
  task_class: "copywriting", status: "ACTIVE", version: 1, max_cost_cents: 50, timeout_ms: 30000,
  primary: { provider: "anthropic", model: "claude-x", price: PRICE },
  fallback: [{ provider: "openai", model: "gpt-y", price: PRICE }],
};

function harness({ route = ROUTE, primary, fallback, remaining = 1000 } = {}) {
  const calls = [], events = [], ledger = [];
  const ok = (n = 1) => ({ content: JSON.stringify({ message: "oi", next_step: "revise" }), input_tokens: 1000 * n, output_tokens: 500 * n });
  const gw = createModelGateway({
    routing: { getRoute: async (tc) => (route && route.task_class === tc ? route : null) },
    providers: {
      anthropic: { complete: async (a) => { calls.push("anthropic"); if (primary) return primary(a); return ok(); } },
      openai: { complete: async (a) => { calls.push("openai"); if (fallback) return fallback(a); return ok(); } },
    },
    budget: {
      remainingCents: async () => remaining,
      record: async (e) => { ledger.push(e); },
    },
    tracer: { event: (e) => events.push(e) },
  });
  return { gw, calls, events, ledger };
}

const req = (o = {}) => ({ task_class: "copywriting", tenant: TENANT, trace_id: "tr_m", messages: [], ...o });

test("calcula custo a partir de tokens e tabela de preco", () => {
  const c = estimateCostCents({ input_tokens: 1_000_000, output_tokens: 1_000_000, price: PRICE });
  assert.equal(c, 1800);
  assert.equal(estimateCostCents({ input_tokens: 1000, output_tokens: 0, price: null }), null);
});

test("caminho feliz devolve custo, tokens e latencia", async () => {
  const { gw, ledger } = harness();
  const r = await gw.complete(req());
  assert.equal(r.provider, "anthropic");
  assert.equal(r.fallback_used, false);
  assert.ok(r.cost_cents > 0);
  assert.equal(r.input_tokens, 1000);
  assert.equal(typeof r.latency_ms, "number");
  assert.equal(ledger.length, 1, "o custo tem que entrar no ledger do workspace");
});

test("task class sem rota ACTIVE nao chama provider nenhum", async () => {
  const { gw, calls } = harness({ route: { ...ROUTE, status: "CANDIDATE" } });
  await assert.rejects(() => gw.complete(req()), (e) => e.reason_code === "MODEL_ROUTE_NOT_ACTIVE");
  assert.equal(calls.length, 0);
});

test("task class desconhecida e recusada", async () => {
  const { gw } = harness();
  await assert.rejects(() => gw.complete(req({ task_class: "vision" })),
    (e) => e.reason_code === "MODEL_ROUTE_NOT_ACTIVE");
});

test("orcamento esgotado bloqueia ANTES de gastar", async () => {
  const { gw, calls } = harness({ remaining: 0 });
  await assert.rejects(() => gw.complete(req()), (e) => e.reason_code === "SPEND_LIMIT_EXCEEDED");
  assert.equal(calls.length, 0, "chamou o provider mesmo sem verba");
});

test("workspace sem orcamento configurado nao roda as cegas", async () => {
  const { gw, calls } = harness({ remaining: null });
  await assert.rejects(() => gw.complete(req()), (e) => e.reason_code === "BUDGET_NOT_CONFIGURED");
  assert.equal(calls.length, 0);
});

test("chamada acima do teto e recusada, mas o gasto e contabilizado", async () => {
  const caro = () => ({ content: "{}", input_tokens: 10_000_000, output_tokens: 10_000_000 });
  const { gw, ledger } = harness({ primary: caro });
  await assert.rejects(() => gw.complete(req()), (e) => e.reason_code === "SPEND_LIMIT_EXCEEDED");
  assert.equal(ledger.length, 1, "gastou de verdade; tem que aparecer no ledger mesmo recusando o resultado");
});

test("erro transitorio cai para o fallback e REGISTRA que caiu", async () => {
  const falha = () => { const e = new Error("overloaded"); e.transient = true; throw e; };
  const { gw, calls } = harness({ primary: falha });
  const r = await gw.complete(req());
  assert.deepEqual(calls, ["anthropic", "openai"]);
  assert.equal(r.provider, "openai");
  assert.equal(r.fallback_used, true, "fallback silencioso e proibido");
  assert.ok(r.fallback_reason, "sem motivo registrado o fallback vira invisivel");
});

test("decisao material NAO cai para fallback sem autorizacao explicita", async () => {
  const falha = () => { const e = new Error("overloaded"); e.transient = true; throw e; };
  const { gw, calls } = harness({ primary: falha });
  await assert.rejects(
    () => gw.complete(req({ material: true })),
    (e) => e.reason_code === "PROVIDER_UNAVAILABLE",
  );
  assert.deepEqual(calls, ["anthropic"], "trocou de modelo numa decisao material sem permissao");
});

test("decisao material cai para fallback quando autorizada, e sinaliza", async () => {
  const falha = () => { const e = new Error("overloaded"); e.transient = true; throw e; };
  const { gw } = harness({ primary: falha });
  const r = await gw.complete(req({ material: true, allow_fallback_on_material: true }));
  assert.equal(r.provider, "openai");
  assert.equal(r.fallback_used, true);
});

test("erro permanente nao tenta o fallback", async () => {
  const falha = () => { throw new Error("modelo nao existe"); };
  const { gw, calls } = harness({ primary: falha });
  await assert.rejects(() => gw.complete(req()));
  assert.deepEqual(calls, ["anthropic"]);
});

test("saida fora do schema e recusada e nao vira tentativa no proximo modelo", async () => {
  const lixo = () => ({ content: JSON.stringify({ campo_inexistente: 1 }), input_tokens: 10, output_tokens: 10 });
  const { gw, calls } = harness({ primary: lixo });
  await assert.rejects(
    () => gw.complete(req({ schema_ref: "olga://io/final-response" })),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED",
  );
  assert.deepEqual(calls, ["anthropic"], "trocar de modelo nao conserta schema errado");
});

test("saida que nao e JSON vira reason code proprio", async () => {
  const texto = () => ({ content: "isso nao e json", input_tokens: 10, output_tokens: 10 });
  const { gw } = harness({ primary: texto });
  await assert.rejects(
    () => gw.complete(req({ schema_ref: "olga://io/final-response" })),
    (e) => e.reason_code === "MODEL_OUTPUT_INVALID",
  );
});

test("o trace carrega provider, modelo, custo e versao do profile", async () => {
  const { gw, events } = harness();
  await gw.complete(req());
  const ev = events.find((e) => e.event === "model.completed");
  assert.ok(ev);
  assert.equal(ev.provider, "anthropic");
  assert.equal(ev.model_profile_version, 1);
  assert.ok(ev.cost_cents > 0);
  assert.equal(ev.content, undefined, "o trace nao deve carregar o conteudo gerado");
});
