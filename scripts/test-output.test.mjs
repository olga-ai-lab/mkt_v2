import test from "node:test";
import assert from "node:assert/strict";
import { requirePassingTest, testSummary } from "./test-output.mjs";

test("le o resumo e o nome de teste do reporter TAP usado na CI", () => {
  const output = "ok 1 - replay nao duplica\n# pass 1\n# fail 0\n";
  assert.deepEqual(testSummary(output), { pass: 1, fail: 0 });
  assert.equal(requirePassingTest(output, "replay"), "replay nao duplica");
});

test("le o resumo e o nome de teste do reporter spec do Node atual", () => {
  const output = "✔ replay nao duplica (2.4ms)\nℹ pass 1\nℹ fail 0\n";
  assert.deepEqual(testSummary(output), { pass: 1, fail: 0 });
  assert.equal(requirePassingTest(output, "replay"), "replay nao duplica");
});

test("recusa suite com falha mesmo que o teste procurado tenha passado", () => {
  const output = "✔ replay nao duplica (2.4ms)\nℹ pass 1\nℹ fail 1\n";
  assert.throws(() => requirePassingTest(output, "replay"), /teste falhando/);
});
