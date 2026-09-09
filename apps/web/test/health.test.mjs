/**
 * O healthcheck tem de reprovar quando o banco cai.
 *
 * Este teste existe porque a alternativa e mais confortavel e errada: um
 * endpoint que responde 200 sempre passa em qualquer verificacao de deploy, e
 * so falha no dia em que era para ele ter falado.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { verificarSaude } from "../lib/health.mjs";

const poolOk = { query: async () => ({ rows: [{ "?column?": 1 }] }) };
const poolFora = { query: async () => { throw new Error("ECONNREFUSED"); } };

test("com banco alcancavel, responde 200 e diz em qual schema esta", async () => {
  // O schema no corpo nao e enfeite: `mkt` e `mkt_v2` sao bases diferentes, e
  // um deploy apontando para a errada responde 200 igual.
  const r = await verificarSaude(poolOk, { schema: "mkt_v2" });
  assert.equal(r.codigo, 200);
  assert.equal(r.corpo.status, "ok");
  assert.equal(r.corpo.schema, "mkt_v2");
  assert.equal(typeof r.corpo.db_ms, "number");
});

test("com banco fora, responde 503 — e nao 500", async () => {
  // A distincao importa para o orquestrador: 503 e indisponibilidade
  // temporaria, 500 e defeito nosso. Railway e Inngest tratam as duas
  // diferente, e responder a errada muda o que a plataforma faz.
  const r = await verificarSaude(poolFora);
  assert.equal(r.codigo, 503);
  assert.equal(r.corpo.status, "degraded");
});

test("a causa da falha nao vaza no corpo", async () => {
  // Endpoint publico e sem autenticacao: mensagem de erro de banco ali e
  // superficie de reconhecimento de graca — host, porta, versao, nome de
  // usuario aparecem em mensagens de driver.
  const poolFalante = {
    query: async () => { throw new Error('FATAL: password authentication failed for user "olga_app" at 10.0.0.7:5432'); },
  };
  const r = await verificarSaude(poolFalante);
  const texto = JSON.stringify(r.corpo);
  for (const vazamento of ["password", "olga_app", "10.0.0.7", "5432"]) {
    assert.ok(!texto.includes(vazamento), `o corpo vazou "${vazamento}": ${texto}`);
  }
});

test("sem MKT_SCHEMA declarado, o corpo diz `mkt` em vez de mentir", async () => {
  const r = await verificarSaude(poolOk);
  assert.equal(r.corpo.schema, "mkt", "e o padrao real das portas; omitir esconderia o alvo errado");
});
