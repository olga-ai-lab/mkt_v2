import Ajv from "ajv";
import addFormats from "ajv-formats";

/*
 * Os schemas entram pelo barril GERADO, e nao por leitura de diretorio.
 *
 * Isto era `readdirSync` + `readFileSync`. Funciona em `node --test` e falha
 * empacotado: o rastreador de arquivos do Next segue `import`, nao caminho
 * montado em tempo de execucao. Os 34 .json ficavam de fora do bundle — o
 * build passava (roda com o repositorio inteiro em disco) e a PRIMEIRA
 * requisicao em producao quebraria, em qualquer rota, porque `assertValid`
 * esta em todas. Deploy verde, 500 imediato.
 *
 * `generated/schemas.mjs` sai de `npm run contracts:generate`, e o CI recusa
 * um diff nao commitado em `generated/` — entao um schema novo que ninguem
 * regenerou quebra no pull request, e nao no deploy.
 */
export { enums, ioSchemas, registrySchemas, domainSchemas, allSchemas }
  from "../generated/schemas.mjs";
import { enums, allSchemas } from "../generated/schemas.mjs";

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
