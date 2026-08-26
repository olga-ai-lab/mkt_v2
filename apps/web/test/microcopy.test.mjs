import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REASON_CODES } from "@olga/contracts";
import { lacunasDe } from "@olga/runtime/brand-activation";

const msgs = JSON.parse(readFileSync(new URL("../messages/reason-codes.pt-BR.json", import.meta.url), "utf8"));

test("todo reason code do enum tem microcopy em pt-BR", () => {
  const faltando = REASON_CODES.filter((c) => !msgs[c]);
  assert.deepEqual(faltando, [], `sem microcopy: ${faltando.join(", ")}`);
});

test("nao ha microcopy orfa apontando para codigo inexistente", () => {
  const orfas = Object.keys(msgs).filter((k) => !REASON_CODES.includes(k));
  assert.deepEqual(orfas, []);
});

test("nenhuma mensagem expoe jargao tecnico ao usuario (MKT-06 §20)", () => {
  const proibido = /\b(null|undefined|exception|stack|500|SQL|NULL|schema|traceback)\b/i;
  for (const [code, texto] of Object.entries(msgs)) {
    assert.ok(!proibido.test(texto), `${code} vaza jargao: "${texto}"`);
  }
});

test("toda mensagem diz o que aconteceu, nao so que falhou", () => {
  for (const [code, texto] of Object.entries(msgs)) {
    assert.ok(texto.length > 25, `${code} curto demais para explicar: "${texto}"`);
    assert.match(texto, /[.!?]$/, `${code} sem pontuacao final`);
  }
});

// ── Lacunas de Brand Brain ──────────────────────────────────────────────────
//
// Mesma disciplina dos reason codes, e pelo mesmo motivo: o dia em que alguem
// acrescentar uma quinta lacuna em lacunasDe(), a tela mostraria o nome cru da
// coluna para quem esta decidindo se assume aquela marca.

const lacunas = JSON.parse(
  readFileSync(new URL("../messages/brand-gaps.pt-BR.json", import.meta.url), "utf8"));

test("toda lacuna que o codigo sabe apontar tem texto em pt-BR", () => {
  // Um objeto vazio produz a lista completa: e a forma de perguntar ao codigo
  // quais lacunas existem, sem repetir a lista aqui.
  const todas = lacunasDe({});
  const faltando = todas.filter((c) => !lacunas[c]);
  assert.deepEqual(faltando, [], `sem microcopy: ${faltando.join(", ")}`);
});

test("nao ha texto de lacuna apontando para campo que nao existe mais", () => {
  const todas = new Set(lacunasDe({}));
  assert.deepEqual(Object.keys(lacunas).filter((k) => !todas.has(k)), []);
});

test("a lacuna diz a consequencia, e nao so o que falta", () => {
  for (const [campo, texto] of Object.entries(lacunas)) {
    assert.ok(texto.includes("—"), `${campo} nao diz a consequencia: "${texto}"`);
    assert.ok(texto.length > 30, `${campo} curto demais: "${texto}"`);
  }
});
