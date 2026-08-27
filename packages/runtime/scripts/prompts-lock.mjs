#!/usr/bin/env node
/**
 * Regrava o lock de prompts com os hashes atuais.
 *
 * ── Por que ele RECUSA em vez de sobrescrever ──────────────────────────────
 *
 * Se este script simplesmente gravasse os hashes novos, versionar prompt seria
 * um número que alguém lembra de subir — e o que alguém precisa lembrar de
 * fazer não é uma garantia.
 *
 * Então o lock guarda o histórico por versão, e a regra é append-only: se a
 * versão corrente já está registrada com outros hashes, o texto mudou sem a
 * versão subir, e o script para dizendo isso. Subir a versão continua sendo
 * decisão de quem mudou o texto; o que deixou de ser opcional é decidir.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { estadoAtual } from "../src/prompts.mjs";

const caminho = new URL("../prompts.lock.json", import.meta.url);
const lock = JSON.parse(readFileSync(caminho, "utf8"));
const atual = estadoAtual();
const registrado = lock.history?.[String(lock.version)];

if (registrado && JSON.stringify(registrado) !== JSON.stringify(atual)) {
  const mudaram = Object.keys(atual).filter((k) => atual[k] !== registrado[k]);
  console.error(
    `A versao ${lock.version} ja esta registrada com outros hashes.\n` +
    `  mudou: ${mudaram.join(", ")}\n` +
    `Suba "version" em prompts.lock.json para ${lock.version + 1} e rode de novo.`);
  process.exit(1);
}

lock.history = { ...(lock.history ?? {}), [String(lock.version)]: atual };
lock.prompts = atual;
writeFileSync(caminho, JSON.stringify(lock, null, 2) + "\n");
console.log(`ok  prompts.lock.json  (versao ${lock.version}, ${Object.keys(atual).length} prompts)`);
