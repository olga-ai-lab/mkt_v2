/**
 * O delta de cada agente.
 *
 * O que se prova aqui: que o delta é camada fina sobre o registry, e não uma
 * segunda definição capaz de divergir dele.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deltaFor, uncertaintyPolicy, AGENTS_COM_DELTA } from "../src/agent-deltas.mjs";

const AGENTE = {
  agent_id: "AGT-MKT-CONTENT",
  mission: "Criar master content e variantes por canal.",
  capabilities: ["brand.read", "content.create_draft"],
  reason_codes: ["CLAIM_UNSUPPORTED", "EVIDENCE_INSUFFICIENT"],
  deviates_from_base: ["Absorve INTEL, PLANNER e VISUAL como capabilities ate a Fase 3."],
};

test("missao e capabilities vem do registry, nao do delta", () => {
  const texto = deltaFor(AGENTE);
  assert.match(texto, /Criar master content e variantes por canal/);
  assert.match(texto, /brand\.read, content\.create_draft/);

  // A prova de que vem do argumento: mudar a linha muda o texto.
  const outro = deltaFor({ ...AGENTE, mission: "Outra missao." });
  assert.match(outro, /Outra missao/);
  assert.ok(!outro.includes("Criar master content"),
    "se o delta tivesse a missao escrita, ela sobreviveria a mudanca no banco");
});

test("nenhum delta cita capability que o agente nao tem", () => {
  // Esta e a divergencia que mais custa: o agente agiria por uma regra e
  // seria julgado pela policy por outra.
  for (const agent_id of AGENTS_COM_DELTA) {
    const texto = deltaFor({ agent_id, mission: "m", capabilities: [], reason_codes: [] });
    assert.ok(!/\b\w+\.\w+\b/.test(texto.split("Na dúvida:")[0].replace(/AGT-[A-Z-]+/g, "")),
      `${agent_id}: o delta nao pode nomear capability por conta propria`);
  }
});

test("o delta so oferece os reason codes que o agente declara", () => {
  const texto = deltaFor(AGENTE);
  assert.match(texto, /CLAIM_UNSUPPORTED, EVIDENCE_INSUFFICIENT/);
  assert.match(texto, /Não invente motivo fora dessa lista/);
});

test("os desvios da base aparecem, porque sao o que difere este agente", () => {
  assert.match(deltaFor(AGENTE), /Absorve INTEL, PLANNER e VISUAL/);
});

test("agente sem capability de escrita e avisado disso", () => {
  const texto = deltaFor({ agent_id: "X", mission: "m", capabilities: [], reason_codes: [] });
  assert.match(texto, /não tem capability de escrita/);
});

test("todo agente tem politica de incerteza, e ela empurra para o lado seguro", () => {
  for (const agent_id of AGENTS_COM_DELTA) {
    const p = uncertaintyPolicy(agent_id);
    assert.ok(p.erro_mais_caro?.length > 20, `${agent_id} sem erro mais caro`);
    assert.ok(p.na_duvida?.length > 20, `${agent_id} sem politica de duvida`);
  }
});

test("agente desconhecido cai na postura mais conservadora, nao na mais solta", () => {
  const p = uncertaintyPolicy("AGT-QUE-NAO-EXISTE");
  assert.match(p.na_duvida, /pare e pergunte/i);
  assert.match(p.na_duvida, /nenhum agente deste sistema erra para o lado de agir mais/i);
});

test("os quatro agentes do MVP tem delta", () => {
  assert.deepEqual(AGENTS_COM_DELTA.sort(), [
    "AGT-MKT-BRAND", "AGT-MKT-COMPLIANCE", "AGT-MKT-CONTENT", "AGT-MKT-COPILOT",
  ]);
});
