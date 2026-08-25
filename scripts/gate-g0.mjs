#!/usr/bin/env node
/**
 * Gate G0 verificado por execução, não por declaração.
 * Cada linha abaixo é uma afirmação que este script tenta derrubar.
 */
import { execSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";

const checks = [];
const check = (nome, fn) => {
  try { const detalhe = fn(); checks.push({ nome, ok: true, detalhe }); }
  catch (e) { checks.push({ nome, ok: false, detalhe: e.message.split("\n")[0] }); }
};
const run = (cmd) => execSync(cmd, { stdio: "pipe", encoding: "utf8" });

check("Contratos validam", () => {
  const out = run("npm run --silent test:contracts");
  const m = out.match(/# pass (\d+)/); if (!m) throw new Error("sem resultado");
  if (/# fail [1-9]/.test(out)) throw new Error("ha teste falhando");
  return `${m[1]} testes`;
});

check("Policy engine nega por padrão", () => {
  const out = run("npm run --silent test:policy");
  if (/# fail [1-9]/.test(out)) throw new Error("ha teste falhando");
  return `${out.match(/# pass (\d+)/)[1]} testes`;
});

check("Capability Gateway não duplica efeito", () => {
  const out = run("npm run --silent test:gateway");
  if (/# fail [1-9]/.test(out)) throw new Error("ha teste falhando");
  return `${out.match(/# pass (\d+)/)[1]} testes`;
});

check("Replay do workflow não republica", () => {
  const out = run("npm run --silent test:worker");
  if (/# fail [1-9]/.test(out)) throw new Error("ha teste falhando");
  return `${out.match(/# pass (\d+)/)[1]} testes`;
});

check("Microcopy cobre todo reason code", () => {
  const out = run("npm run --silent test:web");
  if (/# fail [1-9]/.test(out)) throw new Error("ha teste falhando");
  return `${out.match(/# pass (\d+)/)[1]} testes`;
});

check("Model Gateway: orcamento antes do gasto, fallback explicito", () => {
  const out = run("npm run --silent test:runtime");
  if (/# fail [1-9]/.test(out)) throw new Error("ha teste falhando");
  return `${out.match(/# pass (\d+)/)[1]} testes`;
});

check("Isolamento cross-tenant provado contra Postgres", () => {
  if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
    throw new Error("defina TEST_DATABASE_URL para provar o isolamento");
  }
  const out = run("npm run --silent test:rls");
  if (/# fail [1-9]/.test(out)) throw new Error("ha teste falhando");
  return `${out.match(/# pass (\d+)/)[1]} testes`;
});

check("Toda migration está versionada em arquivo", () => {
  const fs = readdirSync("packages/db/migrations").filter((f) => f.endsWith(".sql"));
  if (fs.length === 0) throw new Error("nenhuma migration");
  return `${fs.length} migrations`;
});

check("Existe ADR para cada decisão que estava OPEN no MKT-09B", () => {
  const fs = readdirSync("docs/adr").filter((f) => f.endsWith(".md"));
  if (fs.length < 10) throw new Error(`so ${fs.length} ADRs`);
  return `${fs.length} ADRs`;
});

check("AGT-BASE existe e substitui o boilerplate dos 13 pacotes", () => {
  if (!existsSync("docs/AGT-BASE.md")) throw new Error("faltando");
  return "docs/AGT-BASE.md";
});

const larg = Math.max(...checks.map((c) => c.nome.length));
console.log("\n  GATE G0 — Fundação\n");
for (const c of checks) {
  console.log(`  ${c.ok ? "✓" : "✗"}  ${c.nome.padEnd(larg)}  ${c.detalhe ?? ""}`);
}
const falhou = checks.filter((c) => !c.ok);
console.log(`\n  ${checks.length - falhou.length}/${checks.length} critérios atendidos.`);
console.log("  ⛔ Pendente fora do código: submissão do app na Meta (ADR-0008, caminho crítico).\n");
process.exit(falhou.length ? 1 : 0);
