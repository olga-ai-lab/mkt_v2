/**
 * O lock de prompts.
 *
 * A Mestra §32 manda versionar prompt e diz como isso se sustenta: "generated
 * files devem ser reproduzíveis; CI detecta drift". Aqui o drift é entre o
 * texto que o runtime manda e o que o lock registra.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROMPTS, PROMPTS_VERSION, LOCK, estadoAtual, hashDoPrompt } from "../src/prompts.mjs";

test("o texto de todo prompt bate com o que o lock registra", () => {
  // Falhou aqui? Um prompt mudou. Rode `npm run prompts:lock` — e se ele
  // recusar, é porque a versão do conjunto precisa subir antes.
  assert.deepEqual(estadoAtual(), LOCK.prompts);
});

test("o lock guarda o historico da versao corrente, e ele bate", () => {
  // É o histórico que torna a regra executável: sem ele, regravar o lock
  // depois de mudar um texto seria silencioso, e a versão viraria carimbo.
  assert.deepEqual(LOCK.history[String(PROMPTS_VERSION)], LOCK.prompts);
});

test("toda versao passada continua registrada", () => {
  for (const v of Object.keys(LOCK.history)) {
    assert.ok(Number(v) >= 1 && Number(v) <= PROMPTS_VERSION,
      `versao ${v} no historico e maior que a corrente`);
    assert.deepEqual(Object.keys(LOCK.history[v]).sort(), Object.keys(PROMPTS).sort(),
      `versao ${v} registra um conjunto de prompts diferente do atual`);
  }
});

test("nenhum prompt do runtime fica de fora do lock", () => {
  // Um prompt novo que não entre em PROMPTS seria um texto indo para o modelo
  // sem versão — e o trace diria uma versão que não o cobre.
  assert.deepEqual(Object.keys(estadoAtual()).sort(), Object.keys(LOCK.prompts).sort());
});

test("o adaptador entra como template, e nao como uma instancia dele", () => {
  // Trocar de canal não pode parecer trocar de prompt.
  assert.match(PROMPTS.adaptador, /\{canal\}/);
  assert.match(PROMPTS.adaptador, /\{limite\}/);
});

test("hash diferente para texto diferente, e igual para o mesmo", () => {
  assert.equal(hashDoPrompt("a"), hashDoPrompt("a"));
  assert.notEqual(hashDoPrompt("a"), hashDoPrompt("b"));
});
