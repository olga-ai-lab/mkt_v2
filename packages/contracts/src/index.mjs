import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Os contratos sao lidos do disco, e nao importados.
 *
 * E deliberado: os mesmos `.json` sao lidos pelo gerador de tipos, citados
 * pelas migrations e validados na CI. Transforma-los em modulos criaria uma
 * segunda copia que um dia divergiria da primeira.
 *
 * O preco disso aparece no empacotamento: um bundler nao rastreia arquivo lido
 * em tempo de execucao, entao a imagem de container precisa copiar estes
 * diretorios explicitamente. Foi assim que a primeira imagem do Railway subiu
 * e respondeu 500 na primeira requisicao — com um ENOENT dentro de um chunk
 * do webpack, longe da causa.
 *
 * Por isso a falta vira uma frase, e nao um stack: quem for empacotar isto
 * noutro lugar recebe o nome do diretorio e o que fazer com ele.
 */
function loadDir(rel) {
  const dir = join(ROOT, rel);
  let arquivos;
  try {
    arquivos = readdirSync(dir);
  } catch (e) {
    throw new Error(
      `contratos ausentes: ${dir} nao existe. Os schemas sao lidos do disco em ` +
      `tempo de execucao, entao empacotar este pacote exige copiar ` +
      `packages/contracts/enums e packages/contracts/schemas junto do codigo ` +
      `(ver Dockerfile). Causa original: ${e.code ?? e.message}`);
  }
  return arquivos
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

export const enums = loadDir("enums");
export const ioSchemas = loadDir("schemas/io");
export const registrySchemas = loadDir("schemas/registry");
export const domainSchemas = loadDir("schemas/domain");
export const allSchemas = [...enums, ...ioSchemas, ...registrySchemas, ...domainSchemas];

/** Enum values by $id, e.g. enumValues("olga://enums/autonomy") */
export function enumValues(id) {
  const e = enums.find((x) => x.$id === id);
  if (!e) throw new Error(`enum not found: ${id}`);
  return e.enum;
}

export const AUTONOMY = enumValues("olga://enums/autonomy");
export const RESPONDABILITY = enumValues("olga://enums/respondability");
export const REASON_CODES = enumValues("olga://enums/reason-codes");
export const RISK_TIERS = enumValues("olga://enums/risk-tier");
export const CONTENT_STATES = enumValues("olga://enums/content-state");
export const CHANNELS = enumValues("olga://enums/channel");
export const POLICY_FACTS = enumValues("olga://enums/policy-fact");

const autonomyDoc = enums.find((e) => e.$id === "olga://enums/autonomy");
export const AUTONOMY_SEMANTICS = autonomyDoc["x-semantics"];
const riskDoc = enums.find((e) => e.$id === "olga://enums/risk-tier");
export const MAX_AUTONOMY_BY_RISK = riskDoc["x-max-autonomy"];
const stateDoc = enums.find((e) => e.$id === "olga://enums/content-state");
export const CONTENT_TRANSITIONS = stateDoc["x-transitions"];

/** A0 < A1 < A2 < A3 < A4 */
export function autonomyRank(level) {
  const i = AUTONOMY.indexOf(level);
  if (i < 0) throw new Error(`unknown autonomy level: ${level}`);
  return i;
}
export function autonomyAtMost(requested, ceiling) {
  return autonomyRank(requested) <= autonomyRank(ceiling);
}
export function canTransition(from, to) {
  return (CONTENT_TRANSITIONS[from] ?? []).includes(to);
}

let _ajv = null;
export function ajv() {
  if (_ajv) return _ajv;
  _ajv = new Ajv({ allErrors: true, strict: false, schemas: allSchemas });
  addFormats(_ajv);
  return _ajv;
}

/** validate("olga://io/capability-request", payload) -> {valid, errors} */
export function validate(schemaId, payload) {
  const v = ajv().getSchema(schemaId);
  if (!v) throw new Error(`schema not found: ${schemaId}`);
  const valid = v(payload);
  return { valid, errors: valid ? [] : v.errors };
}

/** Throws with a readable message. Use at every runtime boundary. */
export function assertValid(schemaId, payload) {
  const { valid, errors } = validate(schemaId, payload);
  if (!valid) {
    const detail = errors.map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
    const err = new Error(`SCHEMA_VALIDATION_FAILED ${schemaId}: ${detail}`);
    err.reason_code = "SCHEMA_VALIDATION_FAILED";
    throw err;
  }
  return payload;
}
