/**
 * As migrations e o bundle.
 *
 * Migration e imutavel depois de aplicada, e o bundle e um arquivo que alguem
 * COLA NO SQL EDITOR de producao. As duas coisas erram caro e erram calado, e e
 * disso que este arquivo trata.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── Imutabilidade ───────────────────────────────────────────────────────────

test("nenhuma migration foi renumerada ou tem numero repetido", () => {
  // Renumerar quebra quem ja aplicou: o runner controla o que rodou pelo
  // prefixo, e dois arquivos com o mesmo numero fazem um deles nunca rodar.
  const dir = new URL("../migrations/", import.meta.url);
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const numeros = arquivos.map((f) => f.slice(0, 4));

  assert.deepEqual([...new Set(numeros)], numeros, "ha numero de migration repetido");
  for (const [i, n] of numeros.entries()) {
    assert.equal(n, String(i + 1).padStart(4, "0"),
      `sequencia quebrada em ${arquivos[i]}: migration nao se renumera`);
  }
});

// ── O bundle e um arquivo que alguem cola em producao ───────────────────────

test("o bundle recusa rodar sem MKT_SCHEMA explicito", () => {
  // Ja aconteceu: um `npm run db:bundle` sem variavel gerou, em silencio, um
  // arquivo apontando para `mkt` — o schema que docs/HANDOFF.md §3.1 proibe
  // tocar, porque tem dados que nao sao nossos — com "drop schema mkt cascade"
  // escrito no cabecalho como instrucao de reversao.
  //
  // Um default conveniente que aponta para o lugar proibido nao e
  // conveniencia: e uma arma carregada com a trava desligada.
  const script = new URL("../scripts/bundle.mjs", import.meta.url).pathname;
  // MKT_BUNDLE_OUT aponta para fora do repositorio: se a trava estiver
  // quebrada, o script gera o arquivo perigoso num diretorio temporario em vez
  // de dentro de packages/db/dist/. O teste falha e nao deixa sujeira.
  const r = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, MKT_SCHEMA: "", MKT_BUNDLE_OUT: mkdtempSync(join(tmpdir(), "bundle-")) },
  });
  assert.equal(r.status, 1, "sem MKT_SCHEMA o script tem de falhar");
  assert.match(r.stderr, /obrigatorio/);
  assert.match(r.stderr, /mkt_v2/, "o erro precisa dizer qual e o alvo certo");
});

test("nenhum bundle versionado aponta para o schema mkt", () => {
  // O que esta em packages/db/dist/ e feito para ser colado num SQL Editor.
  // Um arquivo ali com "drop schema mkt cascade" e um convite a apagar dados
  // da Olga por engano.
  const dir = new URL("../dist/", import.meta.url);
  let arquivos = [];
  try { arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")); } catch { return; }

  for (const f of arquivos) {
    const conteudo = readFileSync(new URL(f, dir), "utf8");
    assert.doesNotMatch(conteudo, /drop schema mkt cascade/,
      `${f} ensina a apagar o schema mkt`);
    assert.doesNotMatch(conteudo, /create table mkt\./,
      `${f} cria tabela no schema mkt; o alvo deste projeto e mkt_v2`);
  }
});
