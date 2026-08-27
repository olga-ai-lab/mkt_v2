/**
 * A camada de persona do prompt.
 *
 * O que se prova aqui é a RENDERIZAÇÃO: que ela projeta o que o registry e a
 * persona declaram, e não escreve nada por conta própria. Quais agentes têm
 * persona é pergunta de banco, e quem responde é packages/db/test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deltaFor, uncertaintyPolicy, personaVersionOf, PERSONA_PADRAO } from "../src/agent-deltas.mjs";

const PERSONA = {
  persona_version: 3,
  identity: "Quem escreve o conteudo da marca.",
  tone: "Claro e concreto, sem superlativo.",
  depth: "OPERACIONAL",
  uncertainty: "escreva sem a afirmacao: texto mais fraco se conserta na revisao.",
  costliest_error: "publicar afirmacao sobre cobertura que a evidencia nao sustenta",
  limits: ["Nao decide se o texto pode ir ao ar."],
  compliance: ["Claim material so existe com evidence."],
  examples: [],
};

const AGENTE = {
  agent_id: "AGT-MKT-CONTENT",
  mission: "Criar master content e variantes por canal.",
  capabilities: ["brand.read", "content.create_draft"],
  reason_codes: ["CLAIM_UNSUPPORTED", "EVIDENCE_INSUFFICIENT"],
  deviates_from_base: ["Absorve INTEL, PLANNER e VISUAL como capabilities ate a Fase 3."],
  persona: PERSONA,
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

test("tom, limites e postura vem da persona, e nao deste arquivo", () => {
  const texto = deltaFor(AGENTE);
  assert.match(texto, /Claro e concreto, sem superlativo/);
  assert.match(texto, /Nao decide se o texto pode ir ao ar/);
  assert.match(texto, /Claim material so existe com evidence/);

  // A prova de que vem do argumento: trocar a persona troca o texto.
  const outro = deltaFor({ ...AGENTE, persona: { ...PERSONA, tone: "Outro tom." } });
  assert.match(outro, /Outro tom/);
  assert.ok(!outro.includes("sem superlativo"));
});

test("a profundidade vira instrucao, e nao a palavra crua", () => {
  // "OPERACIONAL" nao diz nada a um modelo; o que diz e o que fazer com isso.
  const texto = deltaFor(AGENTE);
  assert.ok(!texto.includes("OPERACIONAL"));
  assert.match(texto, /diga o que fazer agora/);
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

test("a politica de incerteza sai da persona daquele agente", () => {
  const p = uncertaintyPolicy(AGENTE);
  assert.match(p.erro_mais_caro, /cobertura que a evidencia nao sustenta/);
  assert.match(p.na_duvida, /escreva sem a afirmacao/);
});

test("agente sem persona cai na postura mais conservadora, nao na mais solta", () => {
  const semPersona = { agent_id: "AGT-QUE-NAO-EXISTE", mission: "m", capabilities: [] };
  const p = uncertaintyPolicy(semPersona);
  assert.match(p.na_duvida, /pare e pergunte/i);
  assert.match(p.na_duvida, /nenhum agente deste sistema erra para o lado de agir mais/i);
  assert.match(deltaFor(semPersona), /pare e pergunte/i);
});

test("a versao da persona e a que o trace registra, e nula quando nao ha", () => {
  // Registrar uma versao inexistente seria pior que registrar nada: o trace
  // apontaria para uma persona que ninguem escreveu.
  assert.equal(personaVersionOf(AGENTE), 3);
  assert.equal(personaVersionOf({ agent_id: "X" }), null);
  assert.equal(PERSONA_PADRAO.persona_version, null);
});
