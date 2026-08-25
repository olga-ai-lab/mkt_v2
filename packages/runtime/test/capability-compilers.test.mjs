/**
 * Compiladores das capabilities da Fase 1.
 *
 * O que se prova aqui: os argumentos nascem de entidades resolvidas e de
 * consulta ao banco — nunca de texto do modelo — e o que falta vira pergunta,
 * não improviso.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPhase1Compilers, CompileError } from "../src/capability-compilers.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const WS = "22222222-2222-2222-2222-222222222222";
const CV = "33333333-3333-3333-3333-333333333333";
const BRAND = "44444444-4444-4444-8444-444444444444";
const TENANT = { org_id: ORG, workspace_id: WS };

const ent = (type, canonical_id, raw) => ({ type, canonical_id, ...(raw ? { raw } : {}) });

// ── content.create_draft ────────────────────────────────────────────────────

test("create_draft monta o alvo a partir da marca resolvida", () => {
  const c = createPhase1Compilers();
  const args = c["content.create_draft"]({
    entities: [ent("brand", BRAND), ent("channel", "INSTAGRAM"), ent("objective", "captacao")],
    context: { brand_brain_version_id: "bb1" }, tenant: TENANT,
  });
  assert.equal(args.brand_id, BRAND);
  assert.equal(args.workspace_id, WS, "o workspace vem do tenant confiavel");
  assert.equal(args.channel, "INSTAGRAM");
  assert.equal(args.brand_brain_version_id, "bb1");
});

test("create_draft sem marca pergunta, nao assume", () => {
  const c = createPhase1Compilers();
  assert.throws(
    () => c["content.create_draft"]({ entities: [], context: {}, tenant: TENANT }),
    (e) => e instanceof CompileError && e.reason_code === "AMBIGUOUS_ENTITY");
});

test("marca sem id canonico nao serve", () => {
  const c = createPhase1Compilers();
  assert.throws(
    () => c["content.create_draft"]({
      entities: [ent("brand", null, "a marca nova")], context: {}, tenant: TENANT }),
    (e) => e.reason_code === "AMBIGUOUS_ENTITY");
});

// ── approval.request ────────────────────────────────────────────────────────

test("approval.request carrega os reason codes da policy, nao de quem pediu", () => {
  const c = createPhase1Compilers();
  const args = c["approval.request"]({
    entities: [ent("content_version", CV)],
    context: { reason_codes: ["COMPLIANCE_REVIEW_REQUIRED"] },
  });
  assert.equal(args.content_version_id, CV);
  assert.deepEqual(args.reason_codes, ["COMPLIANCE_REVIEW_REQUIRED"],
    "sao eles que decidem se vai para compliance ou para a fila comum");
});

// ── publishing.publish ──────────────────────────────────────────────────────

function portaComDestino(destino) {
  const chamadas = [];
  return {
    chamadas,
    findDestination: async (...args) => { chamadas.push(args); return destino; },
  };
}

test("publish resolve conexao e variante no banco, nao no modelo", async () => {
  const publishing = portaComDestino({ connection_id: "conn1", channel_variant_id: "var1" });
  const c = createPhase1Compilers({ publishing });

  const args = await c["publishing.publish"]({
    entities: [ent("content_version", CV), ent("channel", "INSTAGRAM")],
    tenant: TENANT,
  });

  assert.deepEqual(args, {
    channel: "INSTAGRAM", content_version_id: CV,
    connection_id: "conn1", channel_variant_id: "var1",
  });
  assert.deepEqual(publishing.chamadas[0], [ORG, WS, CV, "INSTAGRAM"],
    "a consulta e escopada pelo tenant confiavel");
});

test("um connection_id vindo do modelo nao tem por onde entrar", async () => {
  const publishing = portaComDestino({ connection_id: "conn-correta", channel_variant_id: "var1" });
  const c = createPhase1Compilers({ publishing });

  // O modelo "sugere" uma conexao como se fosse entidade. Ela e ignorada:
  // o compilador so olha content_version e channel.
  const args = await c["publishing.publish"]({
    entities: [
      ent("content_version", CV), ent("channel", "INSTAGRAM"),
      ent("connection", "conn-do-concorrente"),
    ],
    tenant: TENANT,
  });
  assert.equal(args.connection_id, "conn-correta",
    "conexao trocada e post no perfil do cliente errado");
});

test("sem destino, recusa em vez de completar com o que estiver a mao", async () => {
  const c = createPhase1Compilers({ publishing: portaComDestino(null) });
  await assert.rejects(
    () => c["publishing.publish"]({
      entities: [ent("content_version", CV), ent("channel", "INSTAGRAM")], tenant: TENANT }),
    (e) => e.reason_code === "CHANNEL_NOT_CONNECTED" && /variante|conexão/.test(e.message));
});

test("sem canal, pergunta", async () => {
  const c = createPhase1Compilers({ publishing: portaComDestino({ connection_id: "c" }) });
  await assert.rejects(
    () => c["publishing.publish"]({ entities: [ent("content_version", CV)], tenant: TENANT }),
    (e) => e.reason_code === "AMBIGUOUS_ENTITY");
});

test("sem a porta de destino, falha claro em vez de montar pela metade", async () => {
  const c = createPhase1Compilers({});
  await assert.rejects(
    () => c["publishing.publish"]({
      entities: [ent("content_version", CV), ent("channel", "INSTAGRAM")], tenant: TENANT }),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED");
});

test("as tres capabilities da Fase 1 tem compilador", () => {
  const c = createPhase1Compilers({ publishing: portaComDestino(null) });
  for (const cap of ["content.create_draft", "approval.request", "publishing.publish"]) {
    assert.equal(typeof c[cap], "function", `falta compilador para ${cap}`);
  }
});
