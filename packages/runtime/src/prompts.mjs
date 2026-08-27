/**
 * O conjunto de prompts do runtime, e a versão dele.
 *
 * A Mestra §32 manda versionar prompt; a §30 manda o trace registrar essa
 * versão. Sem as duas coisas não se reproduz um incidente: "o agente respondeu
 * isso em setembro" fica sem resposta se ninguém sabe que prompt ele usava em
 * setembro. A coluna `mkt.agent_runs.prompt_version` existe desde a 0005 e
 * nunca foi escrita.
 *
 * ── Por que uma versão do CONJUNTO, e não uma por prompt ───────────────────
 *
 * Porque é o conjunto que produz um run: o resolver interpreta, o planner
 * propõe, o responder explica. Um número por prompt obrigaria o trace a
 * carregar cinco, e a pergunta que se faz num incidente é "qual era o estado
 * dos prompts naquele dia", não "qual era a versão do responder".
 *
 * ── O lock, e o que ele impede ─────────────────────────────────────────────
 *
 * `prompts.lock.json` guarda o hash de cada texto. Mudar um texto sem subir a
 * versão do conjunto quebra o teste — que é o mesmo mecanismo que a §32 pede
 * para arquivo gerado ("CI detecta drift"), aplicado a prompt.
 *
 * Sem isso, versionar prompt seria um número que alguém lembra de subir. O que
 * alguém precisa lembrar de fazer não é uma garantia.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PROMPT_RESOLVER, PROMPT_PLANNER, PROMPT_RESPONDER } from "./agent-stages.mjs";
import { PROMPT_REDATOR, PROMPT_ADAPTADOR } from "./composer.mjs";
import { PROMPT_EXTRATOR } from "./extractor.mjs";

/**
 * Os textos, por id.
 *
 * O adaptador é template: canal e limite entram nele. Fica registrado com
 * marcadores, e não com uma instância — senão trocar de canal pareceria trocar
 * de prompt.
 */
export const PROMPTS = {
  resolver: PROMPT_RESOLVER,
  planner: PROMPT_PLANNER,
  responder: PROMPT_RESPONDER,
  redator: PROMPT_REDATOR,
  adaptador: PROMPT_ADAPTADOR("{canal}", "{limite}"),
  extrator: PROMPT_EXTRATOR,
};

export const hashDoPrompt = (texto) =>
  createHash("sha256").update(String(texto)).digest("hex").slice(0, 16);

/** O estado atual dos textos, no formato do lock. */
export function estadoAtual() {
  return Object.fromEntries(
    Object.entries(PROMPTS).map(([id, texto]) => [id, hashDoPrompt(texto)]));
}

const lock = JSON.parse(
  readFileSync(new URL("../prompts.lock.json", import.meta.url), "utf8"));

/** A versão do conjunto, que o trace registra. */
export const PROMPTS_VERSION = lock.version;
export const LOCK = lock;
