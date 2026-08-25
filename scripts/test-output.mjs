/**
 * Extrai resultados do `node --test` sem depender do reporter escolhido.
 *
 * Node 22 na CI pode emitir TAP (`# pass 15`, `ok 1 - nome`), enquanto
 * versoes mais novas usam o reporter spec (`ℹ pass 15`, `✔ nome`). O gate
 * verifica comportamento; ele nao deve quebrar porque a apresentacao mudou.
 */
export function testSummary(output) {
  const pass = output.match(/^[#ℹ]\s+pass\s+(\d+)\s*$/mu);
  const fail = output.match(/^[#ℹ]\s+fail\s+(\d+)\s*$/mu);

  if (!pass || !fail) {
    throw new Error("saida do test runner sem resumo reconhecivel");
  }

  return { pass: Number(pass[1]), fail: Number(fail[1]) };
}

export function requirePassingTest(output, excerpt) {
  const summary = testSummary(output);
  if (summary.fail > 0) throw new Error("ha teste falhando na suite");

  const line = output.split("\n").find((candidate) => {
    const passed = /^(?:ok\s+\d+\s+-\s+|✔\s+)/u.test(candidate);
    return passed && candidate.includes(excerpt);
  });

  if (!line) throw new Error(`nenhum teste passando contem "${excerpt}"`);

  return line
    .replace(/^(?:ok\s+\d+\s+-\s+|✔\s+)/u, "")
    .replace(/\s+\([\d.]+ms\)\s*$/u, "")
    .slice(0, 58);
}
