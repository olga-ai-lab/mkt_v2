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

// ── A tela de criar conteudo tambem nomeia estados ──────────────────────────
//
// A tela de A2 traduz `respondability` para um rotulo em portugues. Um estado
// novo no enum sem rotulo aqui apareceria ao usuario como a constante crua —
// exatamente a falha que o teste de reason codes existe para impedir, so que
// noutro arquivo. Este teste fecha o mesmo buraco na outra lista.

const respondability = JSON.parse(
  readFileSync(new URL("../../../packages/contracts/enums/respondability.json", import.meta.url), "utf8"));

const tela = readFileSync(new URL("../app/content/novo/criar-conteudo.tsx", import.meta.url), "utf8");

test("todo estado de respondability tem rotulo na tela de criar conteudo", () => {
  const rotulados = new Set([...tela.matchAll(/^ {2}(\w+): \{ rotulo:/gm)].map((m) => m[1]));
  const faltando = respondability.enum.filter((e) => !rotulados.has(e));
  assert.deepEqual(faltando, [],
    `estado sem rotulo em pt-BR na tela: ${faltando.join(", ")}`);
});

test("nao ha rotulo orfao para estado que o enum nao tem", () => {
  const rotulados = [...tela.matchAll(/^ {2}(\w+): \{ rotulo:/gm)].map((m) => m[1]);
  const orfaos = rotulados.filter((r) => !respondability.enum.includes(r));
  assert.deepEqual(orfaos, []);
});
