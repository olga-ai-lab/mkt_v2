#!/usr/bin/env node
/**
 * Gate G1 — Walking skeleton, verificado por execução.
 *
 * O criterio do MKT-17 (Fase 1) e literal:
 *
 *   "um post real publicado numa conta real; receipt com external ID do
 *    provider; trace completo do pedido ao efeito; e um teste que dispara o
 *    replay do workflow e prova que nao houve segunda publicacao."
 *
 * Sao quatro. Tres sao verificaveis por codigo e estao abaixo. O quarto — o
 * post real numa conta real — depende da submissao do app na Meta (ADR-0008),
 * que e prazo externo de duas a seis semanas.
 *
 * Esse quarto item NAO e marcado como atendido nem escondido: ele aparece
 * sempre, como pendencia declarada, do mesmo jeito que o G0 declara a
 * submissao. Um gate que se declara verde com um criterio faltando e pior que
 * gate nenhum, porque cria confianca sem lastro.
 *
 * O MKT-17 tambem lista, para a Fase 1, tres capabilities reais:
 * content.create_draft, approval.request e publishing.publish. A presenca
 * delas no registry e conferida aqui.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { requirePassingTest, testSummary } from "./test-output.mjs";

const checks = [];
const check = (nome, fn) => {
  try { const detalhe = fn(); checks.push({ nome, ok: true, detalhe }); }
  catch (e) { checks.push({ nome, ok: false, detalhe: e.message.split("\n")[0] }); }
};
const run = (cmd) => execSync(cmd, { stdio: "pipe", encoding: "utf8" });

/** Roda um arquivo de teste e exige que um teste com este nome tenha passado. */
function exigeTeste(script, trecho) {
  const out = run(`npm run --silent ${script}`);
  return requirePassingTest(out, trecho);
}

const precisaDeBanco = () => {
  if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error("defina TEST_DATABASE_URL: este criterio so vale contra Postgres");
  }
};

// --- Criterio 2: receipt com external ID do provider ---------------------
check("Receipt carrega o external ID do provider", () => {
  precisaDeBanco();
  return exigeTeste("test:rls", "receipt carrega o external ID do provider");
});

// --- Criterio 3: trace completo do pedido ao efeito ----------------------
check("Trace liga pedido, execucao, efeito e aviso", () => {
  precisaDeBanco();
  return exigeTeste("test:rls", "o trace liga pedido a efeito");
});

// --- Criterio 4: replay nao republica ------------------------------------
check("Replay do workflow nao produz segunda publicacao", () =>
  exigeTeste("test:worker", "GATE G1"));

check("Reentrega do outbox nao produz segunda publicacao", () =>
  exigeTeste("test:worker", "entrega duplicada do mesmo evento"));

// --- A fatia fina existe de ponta a ponta --------------------------------
check("O caminho inteiro roda contra Postgres", () => {
  precisaDeBanco();
  return exigeTeste("test:rls", "aprovar, agendar e publicar, do inicio ao fim");
});

check("Aprovacao vinculada a versao cai quando o conteudo muda", () => {
  precisaDeBanco();
  return exigeTeste("test:rls", "aprovar, editar, e a aprovacao cai");
});

// --- As tres capabilities da Fase 1 estao no registry --------------------
check("As tres capabilities da Fase 1 estao ACTIVE no registry", () => {
  const seed = readFileSync("packages/db/migrations/0006_seed_registries.sql", "utf8");
  const exigidas = ["content.create_draft", "approval.request", "publishing.publish"];
  const faltando = exigidas.filter((c) => !new RegExp(`\\('${c.replace(".", "\\.")}', 1, 'ACTIVE'`).test(seed));
  if (faltando.length) throw new Error(`nao estao ACTIVE: ${faltando.join(", ")}`);
  return exigidas.join(", ");
});

// --- O efeito externo tem uma porta so -----------------------------------
check("Efeito externo passa pelo Capability Gateway", () => {
  const summary = testSummary(run("npm run --silent test:gateway"));
  if (summary.fail > 0) throw new Error("ha teste falhando");
  return `${summary.pass} testes`;
});

check("O adapter real e o falso entram pela mesma porta", () =>
  exigeTeste("test:gateway", "o gateway nao distingue o adapter real do falso"));

// --- Montagem: codigo que ninguem monta nao roda -------------------------
check("O sistema monta com pool, portas e funcoes duraveis", () => {
  precisaDeBanco();
  return exigeTeste("test:rls", "com cliente Inngest, registra o workflow");
});

const larg = Math.max(...checks.map((c) => c.nome.length));
console.log("\n  GATE G1 — Walking skeleton\n");
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.nome.padEnd(larg)}  ${c.detalhe ?? ""}`);
}
const falhou = checks.filter((c) => !c.ok);
console.log(`\n  ${checks.length - falhou.length}/${checks.length} criterios verificaveis atendidos.`);
console.log("");
console.log("  ⛔ FALTA PARA FECHAR O G1, e nao e codigo:");
console.log("     um post real publicado numa conta real, com o adapter em META_ADAPTER=real.");
console.log("     Depende da submissao do app na Meta (ADR-0008, duas a seis semanas).");
console.log("     Ate la o G1 NAO esta fechado, por mais verde que esteja o resto.\n");
process.exit(falhou.length ? 1 : 0);
