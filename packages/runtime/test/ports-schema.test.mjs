/**
 * O schema injetado tem de chegar na consulta.
 *
 * `MKT_SCHEMA` existe porque no projeto de producao os schemas `mkt` e `rh`
 * guardam dados que nao sao nossos (docs/HANDOFF.md §3.1). Uma porta que
 * ignorasse a opcao e caisse no padrao leria a base errada em silencio, e o
 * sintoma apareceria longe da causa.
 *
 * O dublê aqui e um pool que so guarda o SQL: o que esta em teste e a montagem
 * da consulta, nao o Postgres. Contra banco de verdade isso passaria com
 * qualquer schema que existisse.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresPorts } from "../src/ports-postgres.mjs";

function poolEspiao(linhas = []) {
  const consultas = [];
  return {
    consultas,
    async query(sql, params) { consultas.push({ sql, params }); return { rows: linhas }; },
  };
}

test("membershipsOf consulta o schema injetado, nao o padrao", async () => {
  const pool = poolEspiao([{ org_id: "o1", role: "OWNER", workspace_id: "w1" }]);
  const ports = createPostgresPorts(pool, { schema: "mkt_v2" });

  const rows = await ports.iam.membershipsOf("u1");

  const { sql, params } = pool.consultas[0];
  assert.match(sql, /mkt_v2\.memberships/);
  assert.match(sql, /mkt_v2\.workspaces/);
  assert.doesNotMatch(sql, /\bmkt\.memberships\b/);
  assert.deepEqual(params, ["u1"]);
  assert.deepEqual(rows, [{ org_id: "o1", role: "OWNER", workspace_id: "w1" }]);
});

test("o schema vem de MKT_SCHEMA quando ninguem injeta", async () => {
  const anterior = process.env.MKT_SCHEMA;
  process.env.MKT_SCHEMA = "mkt_v2";
  try {
    const pool = poolEspiao();
    await createPostgresPorts(pool).iam.membershipsOf("u1");
    assert.match(pool.consultas[0].sql, /mkt_v2\.memberships/);
  } finally {
    if (anterior === undefined) delete process.env.MKT_SCHEMA;
    else process.env.MKT_SCHEMA = anterior;
  }
});

test("schema com forma invalida e recusado na montagem", () => {
  // O nome do schema entra na consulta por interpolacao — ele nao pode ser
  // parametro. A defesa e recusar tudo que nao seja identificador simples,
  // e ela precisa estar provada, nao suposta.
  assert.throws(() => createPostgresPorts(poolEspiao(), { schema: "mkt; drop schema mkt_v2" }),
                /schema invalido/);
});
