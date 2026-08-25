/**
 * Adapter real do Meta Graph (T3).
 *
 * O transporte entra por injecao, entao tudo aqui roda sem rede. O que estes
 * testes protegem nao e o formato da chamada — e a classificacao de erro, que
 * e a unica decisao que o adapter toma e a unica que pode virar post duplicado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createMetaGraphAdapter, hashRequest } from "../src/adapters/meta-graph.mjs";
import { createGateway } from "../src/index.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const WS = "22222222-2222-2222-2222-222222222222";

const CONEXAO = {
  id: "conn1", org_id: ORG, workspace_id: WS, channel: "INSTAGRAM",
  provider: "meta", external_account_id: "17841400000000000",
  status: "ACTIVE", secret_ref: "vault://meta/conn1", expires_at: null,
};

const VARIANTE = {
  id: "var1", headline: "Proteja o que importa", body: "Seguro residencial a partir de R$ 39.",
  cta: "Simule agora", asset_refs: [{ url: "https://cdn.olga.test/post.jpg" }],
};

const CAP = { capability_id: "publishing.publish", timeout_ms: 5000 };

const PEDIDO = {
  trace_id: "tr_meta",
  tenant: { org_id: ORG, workspace_id: WS },
  args: { channel: "INSTAGRAM", connection_id: "conn1", channel_variant_id: "var1" },
};

/** Transporte falso: uma resposta por chamada, na ordem. */
function transporte(respostas) {
  const chamadas = [];
  const fetch = async (url, init) => {
    chamadas.push({ url, body: JSON.parse(init.body), auth: init.headers.authorization });
    const r = respostas[chamadas.length - 1];
    if (typeof r === "function") return r();
    if (r instanceof Error) throw r;
    return {
      ok: (r.status ?? 200) < 400 && !r.json?.error,
      status: r.status ?? 200,
      json: async () => r.json,
    };
  };
  return { fetch, chamadas };
}

function montar(respostas, over = {}) {
  const t = transporte(respostas);
  const adapter = createMetaGraphAdapter({
    connections: { get: async () => over.conexao ?? CONEXAO },
    secrets: { resolve: async () => over.token ?? "TOKEN_SECRETO" },
    variants: { get: async () => over.variante ?? VARIANTE },
    fetch: t.fetch,
    ...over.deps,
  });
  return { adapter, ...t };
}

const erroMeta = (code, message = "erro", status = 400) =>
  ({ status, json: { error: { code, message, fbtrace_id: "AbC" } } });

// ── Caminho feliz ───────────────────────────────────────────────────────────

test("Instagram: cria o container e publica, nessa ordem", async () => {
  const { adapter, chamadas } = montar([
    { json: { id: "container_1" } },
    { json: { id: "17999999999999999" } },
  ]);

  const r = await adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k1", trace_id: "tr" });

  assert.equal(r.external_id, "17999999999999999");
  assert.match(chamadas[0].url, /17841400000000000\/media$/);
  assert.match(chamadas[1].url, /17841400000000000\/media_publish$/);
  assert.equal(chamadas[1].body.creation_id, "container_1");
  assert.match(chamadas[0].body.caption, /Proteja o que importa/);
  assert.match(chamadas[0].body.caption, /Simule agora/);
});

test("Facebook publica numa chamada so", async () => {
  const { adapter, chamadas } = montar([{ json: { id: "1234_5678" } }], {
    conexao: { ...CONEXAO, channel: "FACEBOOK", external_account_id: "998877" },
  });

  const r = await adapter.call({
    capability: CAP,
    request: { ...PEDIDO, args: { ...PEDIDO.args, channel: "FACEBOOK" } },
    idempotency_key: "k1",
  });

  assert.equal(r.external_id, "1234_5678");
  assert.equal(chamadas.length, 1);
  assert.match(chamadas[0].url, /998877\/feed$/);
});

test("o token vai no header e nao vaza para o request_hash", async () => {
  const { adapter, chamadas } = montar([
    { json: { id: "c1" } }, { json: { id: "p1" } },
  ]);
  const r = await adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k1" });

  assert.equal(chamadas[0].auth, "Bearer TOKEN_SECRETO");
  assert.ok(!JSON.stringify(r).includes("TOKEN_SECRETO"), "o retorno nao pode carregar credencial");
  assert.equal(r.request_hash,
    hashRequest({
      channel: "INSTAGRAM", connection_id: "conn1", channel_variant_id: "var1",
      texto: "Proteja o que importa\n\nSeguro residencial a partir de R$ 39.\n\nSimule agora",
      assets: VARIANTE.asset_refs,
    }));
});

// ── A decisao que importa: o que pode ser tentado de novo ───────────────────

test("ACEITE T3 — timeout ao PUBLICAR nao pode ser tentado de novo", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const { adapter } = montar([{ json: { id: "container_1" } }, timeout]);

  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k1" }),
    (e) => {
      assert.equal(e.retryable, false, "repetir aqui publica duas vezes no perfil do cliente");
      assert.equal(e.error_class, "PERMANENT");
      assert.equal(e.ambiguous, true);
      return true;
    });
});

test("timeout CRIANDO o container pode ser tentado de novo", async () => {
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const { adapter } = montar([timeout]);

  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k1" }),
    (e) => {
      assert.equal(e.retryable, true, "container orfao expira em 24h; nao e post");
      assert.equal(e.error_class, "TRANSIENT");
      return true;
    });
});

test("5xx ao publicar tambem e ambiguo, e tambem para", async () => {
  const { adapter } = montar([{ json: { id: "c1" } }, { status: 503, json: {} }]);
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k1" }),
    (e) => e.retryable === false && e.ambiguous === true);
});

test("5xx criando o container e retentavel", async () => {
  const { adapter } = montar([{ status: 503, json: {} }]);
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k1" }),
    (e) => e.retryable === true);
});

// ── Classificacao dos codigos da Meta ───────────────────────────────────────

test("rate limit e transitorio", async () => {
  for (const code of [4, 17, 32, 613]) {
    const { adapter } = montar([erroMeta(code, "rate limited")]);
    await assert.rejects(
      () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
      (e) => e.reason_code === "PROVIDER_RATE_LIMITED" && e.retryable === true,
      `codigo ${code}`);
  }
});

test("token invalido e permanente e aponta para a conexao", async () => {
  for (const code of [190, 102, 463, 467, 200, 10]) {
    const { adapter } = montar([erroMeta(code, "token")]);
    await assert.rejects(
      () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
      (e) => e.reason_code === "CHANNEL_NOT_CONNECTED" && e.retryable === false,
      `codigo ${code}`);
  }
});

test("duplicidade recusada pela Meta nao vira retry", async () => {
  const { adapter } = montar([erroMeta(506, "Duplicate status message")]);
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
    (e) => e.reason_code === "DUPLICATE_OPERATION_PREVENTED" && e.retryable === false);
});

test("codigo desconhecido nao vira retry as cegas", async () => {
  const { adapter } = montar([erroMeta(99999, "algo novo")]);
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
    (e) => e.retryable === false,
    "o padrao tem de ser nao insistir; a lista e de quem PODE, nao de quem nao pode");
});

test("a mensagem tecnica da Meta nao substitui o reason code", async () => {
  const { adapter } = montar([erroMeta(190, "Error validating access token: session expired")]);
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
    (e) => {
      assert.equal(e.reason_code, "CHANNEL_NOT_CONNECTED");
      assert.match(e.provider_message, /session expired/, "a mensagem crua fica, mas em campo separado");
      return true;
    });
});

// ── Estado da conexao, antes de qualquer chamada ────────────────────────────

test("conexao fora de ACTIVE nem chega a chamar o provider", async () => {
  for (const status of ["PENDING", "DEGRADED", "REVOKED", "EXPIRED"]) {
    const { adapter, chamadas } = montar([], { conexao: { ...CONEXAO, status } });
    await assert.rejects(
      () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
      (e) => e.reason_code === "CHANNEL_NOT_CONNECTED");
    assert.equal(chamadas.length, 0, `${status} nao pode gastar chamada`);
  }
});

test("credencial expirada para antes da rede", async () => {
  const { adapter, chamadas } = montar([], {
    conexao: { ...CONEXAO, expires_at: new Date(Date.now() - 1000).toISOString() },
  });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
    (e) => e.reason_code === "CHANNEL_NOT_CONNECTED");
  assert.equal(chamadas.length, 0);
});

test("conexao de outra organizacao para aqui tambem", async () => {
  const { adapter, chamadas } = montar([], { conexao: { ...CONEXAO, org_id: "outra-org" } });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
    (e) => e.reason_code === "TENANT_SCOPE_VIOLATION");
  assert.equal(chamadas.length, 0);
});

test("conexao de canal diferente do pedido e recusada", async () => {
  const { adapter } = montar([], { conexao: { ...CONEXAO, channel: "FACEBOOK" } });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED");
});

test("Instagram sem imagem e recusado antes da rede", async () => {
  const { adapter, chamadas } = montar([], { variante: { ...VARIANTE, asset_refs: [] } });
  await assert.rejects(
    () => adapter.call({ capability: CAP, request: PEDIDO, idempotency_key: "k" }),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED");
  assert.equal(chamadas.length, 0);
});

test("canal sem suporte falha claro, nao silencioso", async () => {
  const { adapter } = montar([], { conexao: { ...CONEXAO, channel: "LINKEDIN" } });
  await assert.rejects(
    () => adapter.call({
      capability: CAP,
      request: { ...PEDIDO, args: { ...PEDIDO.args, channel: "LINKEDIN" } },
      idempotency_key: "k",
    }),
    (e) => e.reason_code === "UNSUPPORTED_VALUE");
});

// ── O adapter real dentro do gateway ────────────────────────────────────────

test("ACEITE T3 — o gateway nao distingue o adapter real do falso", async () => {
  const CAP_FULL = {
    capability_id: "publishing.publish", version: 1, status: "ACTIVE", mode: "write",
    side_effect: "external", risk_tier: "MEDIUM", permissions: ["OWNER"],
    provider_adapter: "meta_graph", max_attempts: 3, timeout_ms: 5000,
    idempotency: { required: true, key_template: "{workspace_id}:{content_version_id}:{channel}:{connection_id}" },
  };
  const POL = {
    policy_id: "P", version: 1, status: "ACTIVE", priority: 500,
    scope: { capability_id: "publishing.publish" },
    conditions: [{ fact: "channel_connected", op: "is_true", value: true }],
    effect: "ALLOW", max_autonomy: "A3",
  };

  const guardados = [];
  let seq = 0;
  const { adapter, chamadas } = montar([{ json: { id: "c1" } }, { json: { id: "post_real" } }]);

  const gateway = createGateway({
    registry: {
      getCapability: async () => CAP_FULL,
      newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    },
    policies: { listActive: async () => [POL] },
    receipts: {
      find: async (o, c, k) => guardados.find((r) => r.idempotency_key === k) ?? null,
      save: async (r) => { guardados.push(r); },
    },
    adapters: { meta_graph: adapter },
  });

  const pedido = {
    trace_id: "tr_g", tenant: { org_id: ORG, workspace_id: WS },
    capability_id: "publishing.publish", capability_version: 1, mode: "write",
    args: { channel: "INSTAGRAM", content_version_id: "cv1", connection_id: "conn1", channel_variant_id: "var1" },
    idempotency_key: `${WS}:cv1:INSTAGRAM:conn1`,
    requested_autonomy: "A3",
  };
  const facts = { channel_connected: true, content_status: "APPROVED", brand_brain_status: "ACTIVE",
                  evidence_coverage: true, workspace_first_publish: false, claim_types: ["GENERAL"] };

  const r1 = await gateway.execute(pedido, { facts, actor: { role: "OWNER", org_id: ORG } });
  assert.equal(r1.execution.status, "SUCCEEDED");
  assert.equal(r1.execution.external_id, "post_real");
  assert.equal(r1.receipt.request_hash.length, 64, "o hash do adapter real chega ao receipt");

  // Replay: mesma chave, o gateway deduplica antes de tocar no adapter.
  const r2 = await gateway.execute(pedido, { facts, actor: { role: "OWNER", org_id: ORG } });
  assert.equal(r2.execution.status, "DEDUPLICATED");
  assert.equal(chamadas.length, 2, "o provider foi chamado de novo no replay");
  assert.equal(guardados.length, 1);
});

test("erro ambiguo do adapter real interrompe o retry do gateway", async () => {
  const CAP_FULL = {
    capability_id: "publishing.publish", version: 1, status: "ACTIVE", mode: "write",
    side_effect: "external", risk_tier: "MEDIUM", permissions: ["OWNER"],
    provider_adapter: "meta_graph", max_attempts: 5, timeout_ms: 5000,
    idempotency: { required: true, key_template: "{workspace_id}:{channel}" },
  };
  const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
  // Container OK; publicar estoura sem resposta. Com max_attempts=5, um adapter
  // que marcasse isso como retentavel tentaria publicar cinco vezes.
  const { adapter, chamadas } = montar([{ json: { id: "c1" } }, timeout]);

  const gateway = createGateway({
    registry: { getCapability: async () => CAP_FULL, newId: () => "00000000-0000-4000-8000-000000000001" },
    // Sem policy ACTIVE o engine nega por padrao e a execucao nem chega ao
    // adapter — que e o comportamento certo, mas nao e o que este teste mede.
    policies: { listActive: async () => [{
      policy_id: "P_AMB", version: 1, status: "ACTIVE", priority: 500,
      scope: { capability_id: "publishing.publish" },
      conditions: [{ fact: "channel_connected", op: "is_true", value: true }],
      effect: "ALLOW", max_autonomy: "A3",
    }] },
    receipts: { find: async () => null, save: async () => {} },
    adapters: { meta_graph: adapter },
  });

  const r = await gateway.execute({
    trace_id: "tr_amb", tenant: { org_id: ORG, workspace_id: WS },
    capability_id: "publishing.publish", capability_version: 1, mode: "write",
    args: { channel: "INSTAGRAM", connection_id: "conn1", channel_variant_id: "var1" },
    idempotency_key: `${WS}:INSTAGRAM`,
    requested_autonomy: "A2",
  }, { facts: { channel_connected: true }, actor: { role: "OWNER", org_id: ORG } });

  assert.equal(r.execution.status, "FAILED");
  assert.equal(r.execution.attempts, 1, "o gateway parou na primeira, como o adapter pediu");
  assert.equal(chamadas.length, 2, "so uma tentativa de publicar chegou na rede");
});
