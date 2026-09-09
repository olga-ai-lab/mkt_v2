/**
 * O lote e a unica parte do produto em que um clique gasta dinheiro N vezes.
 * Estes testes sao todos sobre o freio.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createBatchRunner, MAX_POR_LOTE, RECUSAS_TERMINAIS, BatchError } from "../src/batch.mjs";

const TENANT = { org_id: "o1", workspace_id: "w1" };
const ACTOR = { id: "u1", role: "OWNER", org_id: "o1" };

/** Loop roteirizado: devolve o que a lista mandar, na ordem. */
function loopFalso(roteiro) {
  const chamadas = [];
  return {
    chamadas,
    agentLoop: {
      async run(req) {
        chamadas.push(req.input.text);
        const passo = roteiro[chamadas.length - 1] ?? { ok: true };
        if (passo.lanca) {
          const e = new Error(passo.lanca);
          e.reason_code = passo.lanca;
          throw e;
        }
        return {
          run_id: `run_${chamadas.length}`, trace_id: `tr_${chamadas.length}`,
          response: {
            respondability: passo.respondability ?? "EXECUTABLE",
            message: "ok", reason_codes: passo.reason_codes ?? [],
          },
        };
      },
    },
  };
}

const pedido = (briefs, extra = {}) => ({
  tenant: TENANT, actor: ACTOR, agent_id: "AGT-MKT-CONTENT", briefs, ...extra,
});

test("o caminho normal roda um item por brief, na ordem", async () => {
  const { agentLoop, chamadas } = loopFalso([]);
  const r = await createBatchRunner({ agentLoop })(pedido(["um", "dois", "tres"]));

  assert.deepEqual(chamadas, ["um", "dois", "tres"]);
  assert.equal(r.interrompido, null);
  assert.equal(r.itens.length, 3);
  assert.ok(r.itens.every((i) => i.estado === "EXECUTADO"));
  assert.deepEqual(r.itens.map((i) => i.trace_id), ["tr_1", "tr_2", "tr_3"],
    "cada item tem trace proprio: sem isso, auditar um lote de vinte seria impossivel");
});

test("recusa de orcamento PARA o lote em vez de tentar os seguintes", async () => {
  // O ponto inteiro deste modulo. Sem isto, uma configuracao faltando custaria
  // vinte chamadas de rede para colher a mesma negativa vinte vezes.
  const { agentLoop, chamadas } = loopFalso([
    { ok: true },
    { lanca: "BUDGET_NOT_CONFIGURED" },
  ]);
  const r = await createBatchRunner({ agentLoop })(pedido(["a", "b", "c", "d"]));

  assert.equal(chamadas.length, 2, "parou na recusa; nao tentou c nem d");
  assert.equal(r.interrompido, "BUDGET_NOT_CONFIGURED");
  assert.deepEqual(r.itens.map((i) => i.estado),
    ["EXECUTADO", "FALHOU", "NAO_TENTADO", "NAO_TENTADO"]);
});

test("teto de gasto estourado tambem para o lote", async () => {
  const { agentLoop, chamadas } = loopFalso([{ lanca: "SPEND_LIMIT_EXCEEDED" }]);
  const r = await createBatchRunner({ agentLoop })(pedido(["a", "b", "c"]));

  assert.equal(chamadas.length, 1);
  assert.equal(r.interrompido, "SPEND_LIMIT_EXCEEDED");
});

test("recusa terminal que chega como RESPOSTA, e nao como excecao, tambem para", async () => {
  // O loop encerra com reason code em vez de levantar quando a policy para.
  // Sem este caso, o freio funcionaria so para metade dos caminhos.
  const { agentLoop, chamadas } = loopFalso([
    { respondability: "TEMPORARILY_UNAVAILABLE", reason_codes: ["BUDGET_NOT_CONFIGURED"] },
  ]);
  const r = await createBatchRunner({ agentLoop })(pedido(["a", "b", "c"]));

  assert.equal(chamadas.length, 1);
  assert.equal(r.interrompido, "BUDGET_NOT_CONFIGURED");
  assert.equal(r.itens[0].estado, "EXECUTADO", "houve resposta; ela e que foi negativa");
});

test("recusa de UM item nao para o lote", async () => {
  // O par do teste acima, e ele importa tanto quanto: um brief ambiguo ou um
  // claim sem lastro e resultado daquele item. Parar tudo por causa dele
  // tornaria o lote inutil na primeira frase mal escrita.
  const { agentLoop, chamadas } = loopFalso([
    { respondability: "CLARIFICATION_REQUIRED", reason_codes: ["AMBIGUOUS_GOAL"] },
    { ok: true },
    { respondability: "QUALITY_BLOCKED", reason_codes: ["CLAIM_UNSUPPORTED"] },
  ]);
  const r = await createBatchRunner({ agentLoop })(pedido(["a", "b", "c"]));

  assert.equal(chamadas.length, 3, "todos foram tentados");
  assert.equal(r.interrompido, null);
  assert.deepEqual(r.itens.map((i) => i.respondability),
    ["CLARIFICATION_REQUIRED", "EXECUTABLE", "QUALITY_BLOCKED"]);
});

test("os itens nao tentados sao marcados como tal, e nao como falha", async () => {
  // A tela precisa distinguir "tentou e nao deu" de "nem chegou a tentar".
  // Confundir os dois faria a pessoa reescrever briefs que estavam bons.
  const { agentLoop } = loopFalso([{ lanca: "SPEND_LIMIT_EXCEEDED" }]);
  const r = await createBatchRunner({ agentLoop })(pedido(["a", "b"]));

  assert.equal(r.itens[1].estado, "NAO_TENTADO");
  assert.equal(r.itens[1].brief, "b", "o brief volta, para a pessoa poder reenviar");
  assert.equal(r.itens[1].reason_codes, undefined);
});

test("lote acima do teto e recusado ANTES de gastar o primeiro centavo", async () => {
  const { agentLoop, chamadas } = loopFalso([]);
  const briefs = Array.from({ length: MAX_POR_LOTE + 1 }, (_, i) => `brief ${i}`);

  await assert.rejects(() => createBatchRunner({ agentLoop })(pedido(briefs)),
    (e) => e instanceof BatchError && e.reason_code === "UNSUPPORTED_VALUE");
  assert.equal(chamadas.length, 0, "um teto conferido no meio do laco ja teria custado os anteriores");
});

test("exatamente no teto passa", async () => {
  const { agentLoop, chamadas } = loopFalso([]);
  const briefs = Array.from({ length: MAX_POR_LOTE }, (_, i) => `brief ${i}`);
  await createBatchRunner({ agentLoop })(pedido(briefs));
  assert.equal(chamadas.length, MAX_POR_LOTE);
});

test("brief vazio ou so espaco nao vira chamada", async () => {
  const { agentLoop, chamadas } = loopFalso([]);
  const r = await createBatchRunner({ agentLoop })(pedido(["  ", "vale", "", "\n\t"]));
  assert.deepEqual(chamadas, ["vale"]);
  assert.equal(r.itens.length, 1);
});

test("lote sem nenhum brief util e recusado", async () => {
  const { agentLoop } = loopFalso([]);
  await assert.rejects(() => createBatchRunner({ agentLoop })(pedido(["", "   "])),
    (e) => e.reason_code === "SCHEMA_VALIDATION_FAILED");
});

test("as recusas terminais sao reason codes que o enum conhece", async () => {
  // O enum e fechado. Uma constante com um codigo inventado nunca casaria, e o
  // freio simplesmente nao freiaria — em silencio.
  const { REASON_CODES } = await import("@olga/contracts");
  for (const c of RECUSAS_TERMINAIS) {
    assert.ok(REASON_CODES.includes(c), `${c} nao esta no enum de reason codes`);
  }
});

test("tenant e ator vao para o loop sem passar pelo brief", async () => {
  // O brief e texto de usuario. Se o lote deixasse tenant vir dali, seria a
  // mesma violacao que o loop recusa — so que uma camada acima.
  let visto = null;
  const agentLoop = { async run(req) { visto = req; return { run_id: "r", trace_id: "t", response: {} }; } };
  await createBatchRunner({ agentLoop })(pedido(["um"]));

  assert.deepEqual(visto.tenant, TENANT);
  assert.deepEqual(visto.actor, ACTOR);
  assert.deepEqual(visto.input, { text: "um" });
});
