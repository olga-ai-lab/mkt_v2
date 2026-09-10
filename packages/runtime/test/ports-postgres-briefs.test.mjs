/**
 * As portas de mkt.content_briefs (0011_content_briefs), contra Postgres de
 * verdade — não dublê. É exatamente o padrão de erro que o CLAUDE.md descreve:
 * uma porta escrita e nunca exercitada esconde a query que não roda.
 *
 * Requer TEST_DATABASE_URL com as migrations aplicadas. Sem ele, este arquivo
 * pula — não finge que passou.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPostgresPorts } from "../src/ports-postgres.mjs";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

test("portas de content_briefs", { skip: !url && "sem TEST_DATABASE_URL" }, async (t) => {
  const pool = new pg.Pool({ connectionString: url });
  const ports = createPostgresPorts(pool);
  const ids = {};

  // Sufixo unico por execucao: dois runs (ou um anterior que nao chegou a
  // limpar) nao podem colidir nas unique constraints. mkt.app_users nao tem
  // FK para organizations — apagar a org no finally nao apaga o usuario — e
  // por isso o email tambem carrega o sufixo e a limpeza cobre os dois.
  const sufixo = crypto.randomUUID();
  ids.email = `smoke-${sufixo}@briefs-runtime-test.com`;
  const org = await pool.query(
    `insert into mkt.organizations (name, slug) values ($1,$2) returning id`,
    ["Smoke Briefs", `smoke-briefs-runtime-test-${sufixo}`]);
  ids.org_id = org.rows[0].id;
  ids.workspace_id = (await pool.query(
    `insert into mkt.workspaces (org_id, name) values ($1,'Principal') returning id`,
    [ids.org_id])).rows[0].id;
  ids.user_id = (await pool.query(
    `insert into mkt.app_users (email, full_name) values ($1,'Smoke') returning id`,
    [ids.email])).rows[0].id;
  ids.brand_id = (await pool.query(
    `insert into mkt.brands (org_id, workspace_id, name) values ($1,$2,'Marca Smoke') returning id`,
    [ids.org_id, ids.workspace_id])).rows[0].id;

  try {
    await t.test("create grava o pedido como veio do formulario", async () => {
      const brief_id = await ports.briefs.create({
        org_id: ids.org_id, workspace_id: ids.workspace_id,
        brand_name: "Corretora Teste", objective: "divulgar campanha",
        channel: "INSTAGRAM", briefing: "fale sobre seguro auto",
        submitted_by_actor_id: ids.user_id,
      });
      assert.ok(brief_id);
      ids.brief_id = brief_id;
    });

    await t.test("recordOutcome fecha a linha com a recusa, sem versao", async () => {
      await ports.briefs.recordOutcome(ids.brief_id, {
        trace_id: "trace-recusado", run_id: "run-1", reason_code: "CLARIFICATION_REQUIRED",
      });
      const { rows } = await pool.query(
        `select reason_code, content_version_id, resolved_at from mkt.content_briefs where id = $1`,
        [ids.brief_id]);
      assert.equal(rows[0].reason_code, "CLARIFICATION_REQUIRED");
      assert.equal(rows[0].content_version_id, null);
      assert.ok(rows[0].resolved_at);
    });

    await t.test("contentVersionByTrace acha a versao que o mesmo trace produziu", async () => {
      const draft = await ports.authoring.createDraft({
        org_id: ids.org_id, workspace_id: ids.workspace_id, brand_id: ids.brand_id,
        title: "T", objective: "o", master_body: "corpo",
        actor_id: null, trace_id: "trace-sucesso",
        agent_id: "AGT-MKT-CONTENT", agent_version: 1,
      });
      const achado = await ports.knowledge.contentVersionByTrace(ids.org_id, "trace-sucesso");
      assert.equal(achado, draft.content_version_id);
      ids.content_version_id = draft.content_version_id;
    });

    await t.test("contentVersionByTrace devolve null para trace que nao produziu nada", async () => {
      const achado = await ports.knowledge.contentVersionByTrace(ids.org_id, "trace-que-nao-existe");
      assert.equal(achado, null);
    });

    await t.test("recordOutcome com coalesce preserva o que ja foi gravado", async () => {
      await ports.briefs.recordOutcome(ids.brief_id, {
        trace_id: "trace-sucesso", content_version_id: ids.content_version_id,
      });
      const { rows } = await pool.query(
        `select reason_code, content_version_id from mkt.content_briefs where id = $1`, [ids.brief_id]);
      // reason_code nao foi passado desta vez: coalesce mantem o da chamada anterior.
      assert.equal(rows[0].reason_code, "CLARIFICATION_REQUIRED");
      assert.equal(rows[0].content_version_id, ids.content_version_id);
    });
  } finally {
    await pool.query(`delete from mkt.organizations where id = $1`, [ids.org_id]);
    await pool.query(`delete from mkt.app_users where id = $1`, [ids.user_id]);
    await pool.end();
  }
});
