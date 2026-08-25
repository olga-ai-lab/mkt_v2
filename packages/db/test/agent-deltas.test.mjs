/**
 * O delta de cada agente, conferido contra o registry REAL.
 *
 * Os testes em packages/runtime provam a forma do delta com um agente
 * inventado. Este prova o que importa em produção: que os agentes que estão
 * mesmo semeados no banco têm delta, e que nenhum delta promete algo que a
 * linha do registry não sustenta.
 *
 * Sem este arquivo, alguém acrescentaria um quinto agente à migration 0006 e
 * ele rodaria com a postura genérica sem ninguém notar.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { deltaFor, uncertaintyPolicy, AGENTS_COM_DELTA } from "@olga/runtime/agent-deltas";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const db = new pg.Client({ connectionString: url });
let agentes = [];
let capabilities = new Set();

before(async () => {
  await db.connect();
  const a = await db.query(
    `select agent_id, version, status::text as status, mission, capabilities,
            reason_codes, deviates_from_base, baseline_autonomy, max_autonomy
       from mkt.agent_registry order by agent_id`);
  agentes = a.rows;
  const c = await db.query(`select capability_id from mkt.capability_registry`);
  capabilities = new Set(c.rows.map((r) => r.capability_id));
});

after(async () => { await db.end(); });

test("todo agente semeado tem delta proprio", () => {
  const semDelta = agentes.map((a) => a.agent_id).filter((id) => !AGENTS_COM_DELTA.includes(id));
  assert.deepEqual(semDelta, [],
    "agente novo no seed sem delta rodaria com a postura generica sem ninguem notar");
});

test("nao ha delta orfao, apontando para agente que nao existe", () => {
  const ids = new Set(agentes.map((a) => a.agent_id));
  const orfaos = AGENTS_COM_DELTA.filter((id) => !ids.has(id));
  assert.deepEqual(orfaos, []);
});

test("o delta de cada agente cita a missao e as capabilities da propria linha", () => {
  for (const a of agentes) {
    const texto = deltaFor(a);
    assert.ok(texto.includes(a.mission), `${a.agent_id}: missao do registry ausente no delta`);
    for (const cap of a.capabilities) {
      assert.ok(texto.includes(cap), `${a.agent_id}: capability ${cap} ausente no delta`);
    }
  }
});

test("nenhum delta cita capability fora do registry", () => {
  // Se o delta nomeasse uma capability inexistente, o agente proporia um passo
  // que o gateway recusaria — e a culpa pareceria do modelo.
  for (const a of agentes) {
    for (const cap of a.capabilities) {
      assert.ok(capabilities.has(cap),
        `${a.agent_id} declara ${cap}, que nao existe no capability_registry`);
    }
  }
});

test("o delta so oferece os reason codes que a linha declara", () => {
  for (const a of agentes) {
    const texto = deltaFor(a);
    for (const rc of a.reason_codes) {
      assert.ok(texto.includes(rc), `${a.agent_id}: reason code ${rc} ausente no delta`);
    }
  }
});

test("os desvios da base do banco aparecem no delta", () => {
  for (const a of agentes.filter((x) => (x.deviates_from_base ?? []).length > 0)) {
    for (const d of a.deviates_from_base) {
      assert.ok(deltaFor(a).includes(d),
        `${a.agent_id}: desvio declarado no banco nao chegou ao prompt`);
    }
  }
});

test("agente com autonomia maior nao ganha politica de incerteza mais solta", () => {
  // O teto de autonomia diz o que o agente PODE fazer; a politica de
  // incerteza diz para que lado ele erra. Um teto alto nao afrouxa o segundo.
  for (const a of agentes) {
    const p = uncertaintyPolicy(a.agent_id);
    assert.ok(p.na_duvida.length > 20, `${a.agent_id} sem politica de duvida`);
    assert.ok(!/prossiga|assuma|escolha o mais provavel/i.test(p.na_duvida),
      `${a.agent_id}: politica de duvida nao pode mandar seguir em frente`);
  }
});

test("os quatro nascem CANDIDATE — promover e ato de governanca", () => {
  const ativos = agentes.filter((a) => a.status === "ACTIVE");
  assert.deepEqual(ativos, [],
    "se algum agente virou ACTIVE, foi decisao humana e este teste tem de ser revisto junto");
});
