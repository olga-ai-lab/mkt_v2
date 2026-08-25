import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REASON_CODES } from "@olga/contracts";

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
