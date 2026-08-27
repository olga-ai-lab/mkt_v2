/**
 * O barril exporta o que promete.
 *
 * Ninguém importa de `@olga/runtime` hoje — todo consumidor usa o subpath, que
 * é mais explícito sobre o acoplamento. Foi assim que `index.mjs` carregou por
 * semanas um `AGENTS_COM_DELTA` que deixou de existir quando `agent-deltas`
 * virou um renderizador de persona: nenhum teste importava o barril, então o
 * `SyntaxError` esperava a primeira pessoa que precisasse dele.
 *
 * Este arquivo é curto de propósito. Ele não testa comportamento nenhum: testa
 * que o índice do pacote e o pacote não divergiram.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as barril from "../src/index.mjs";

test("todo nome exportado pelo barril existe de verdade", () => {
  // O import acima já falharia com SyntaxError se um nome não existisse. A
  // asserção abaixo cobre o outro lado: um barril que virou vazio por acidente
  // continuaria importando sem erro.
  const nomes = Object.keys(barril);
  assert.ok(nomes.length > 20, `o barril exporta so ${nomes.length} nomes`);
  for (const n of nomes) assert.notEqual(barril[n], undefined, n);
});

test("todo subpath declarado no package.json aponta para arquivo que carrega", async () => {
  // Um subpath quebrado só aparece quando alguém o usa, e o composition root
  // usa cinco deles. Aqui todos são carregados de uma vez.
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  for (const [sub, alvo] of Object.entries(pkg.exports)) {
    const m = await import(new URL(alvo, new URL("../", import.meta.url)));
    assert.ok(Object.keys(m).length > 0, `${sub} nao exporta nada`);
  }
});
