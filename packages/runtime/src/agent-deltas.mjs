/**
 * A camada de persona do prompt.
 *
 * O AGT-BASE diz o que fica no delta de um agente e nada mais: charter,
 * contratos, casos de teste específicos e desvios explícitos da base. A Mestra
 * §9 acrescenta os oito campos do contrato conversacional — identity, mission,
 * tone, uncertainty, depth, limits, compliance e examples — e o §32 manda
 * versionar isso.
 *
 * ── O que mudou aqui, e por quê ────────────────────────────────────────────
 *
 * Este arquivo guardava, num objeto literal, o "erro mais caro" e o "na dúvida"
 * de cada agente. Ele mesmo argumentava — com razão — que missão e capabilities
 * NÃO deviam ser reescritas em código porque já eram dado, e então guardava em
 * código a única parte que "não cabia numa coluna".
 *
 * Agora cabe: `mkt.agent_personas`, com as oito colunas do §9 e uma versão
 * própria. Este arquivo deixou de ser a fonte e virou o que sempre deveria ter
 * sido — o RENDERIZADOR. Ele projeta no prompt o que o banco declara, e não
 * conhece nenhum agente pelo nome.
 *
 * A diferença aparece no dia em que alguém muda o tom de um agente: hoje isso é
 * uma migration, revisável, com versão que o trace registra. Antes era um
 * commit no meio de um objeto literal, e o trace não tinha como dizer com que
 * persona aquele run falou.
 *
 * ── A postura padrão continua existindo ────────────────────────────────────
 *
 * Um agente sem persona ACTIVE não fica sem persona: recebe a mais
 * conservadora. Isso é fail-closed, não conveniência — e a migration 0013
 * recusa deixar um agente ACTIVE nessa situação, para que o padrão seja rede de
 * segurança e não o estado normal das coisas.
 */

/**
 * Fallback para agente sem persona própria: a postura mais conservadora.
 *
 * `persona_version: null` é o que faz o trace dizer a verdade — "este run falou
 * sem persona declarada" — em vez de registrar uma versão que não existe.
 */
export const PERSONA_PADRAO = {
  persona_version: null,
  identity: "Um agente da Olga.",
  tone: "Direto e sem adjetivo.",
  depth: "OPERACIONAL",
  costliest_error: "agir além do que foi pedido",
  uncertainty: "pare e pergunte. Nenhum agente deste sistema erra para o lado de agir mais.",
  limits: [],
  compliance: [],
  examples: [],
};

const comoLista = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);

/**
 * Monta o texto da persona a partir da linha do registry e da persona.
 *
 * Missão, capabilities, reason codes e desvios vêm do argumento `agent` — ou
 * seja, do `agent_registry`. Tom, limites e política de incerteza vêm de
 * `agent.persona`, que a porta anexa a partir de `agent_personas`. Nenhum dos
 * dois é escrito aqui.
 */
export function deltaFor(agent) {
  const p = { ...PERSONA_PADRAO, ...(agent?.persona ?? {}) };
  const capabilities = agent?.capabilities ?? [];
  const reasonCodes = agent?.reason_codes ?? [];
  const desvios = agent?.deviates_from_base ?? [];

  const linhas = [
    `Você é ${agent?.agent_id}. ${p.identity}`,
    `Missão: ${agent?.mission ?? "não declarada"}`,
    `Tom: ${p.tone}`,
    `Profundidade da resposta: ${PROFUNDIDADE[p.depth] ?? PROFUNDIDADE.OPERACIONAL}`,
    capabilities.length
      ? `Você só pode propor estas capabilities: ${capabilities.join(", ")}.`
      : "Você não tem capability de escrita: apenas interprete e explique.",
    "",
    `O erro que custa mais caro no seu papel: ${p.costliest_error}.`,
    `Na dúvida: ${p.uncertainty}`,
  ];

  const limites = comoLista(p.limits);
  if (limites.length) {
    linhas.push("", "O que você NÃO decide nem afirma:", ...limites.map((x) => `- ${x}`));
  }

  const obrigatorio = comoLista(p.compliance);
  if (obrigatorio.length) {
    linhas.push("", "Obrigatório no que você produz:", ...obrigatorio.map((x) => `- ${x}`));
  }

  if (reasonCodes.length) {
    linhas.push(
      "",
      `Quando algo impedir a resposta, use um destes motivos: ${reasonCodes.join(", ")}.`,
      "Não invente motivo fora dessa lista.",
    );
  }

  if (desvios.length) {
    linhas.push("", "Regras específicas suas, que valem sobre a base:", ...desvios.map((x) => `- ${x}`));
  }

  // Exemplos entram por último e são poucos de propósito: eles ensinam forma, e
  // uma lista longa vira o "prompt gigante como banco de regras" que a Mestra
  // §47 lista como anti-pattern que bloqueia aprovação.
  const exemplos = Array.isArray(p.examples) ? p.examples.slice(0, 4) : [];
  if (exemplos.length) {
    linhas.push("", "Exemplos:");
    for (const e of exemplos) {
      linhas.push(`- [${e.kind}] ${e.situacao} → ${e.resposta}${e.porque ? ` (${e.porque})` : ""}`);
    }
  }

  return linhas.join("\n");
}

const PROFUNDIDADE = {
  EXECUTIVO: "resposta curta, com a conclusão primeiro.",
  ANALISTA: "explique o critério e o que sustenta a conclusão.",
  OPERACIONAL: "diga o que fazer agora e o que acontece depois.",
};

/** Só a política de incerteza, para quem quiser montar o próprio texto. */
export function uncertaintyPolicy(agent) {
  const p = { ...PERSONA_PADRAO, ...(agent?.persona ?? {}) };
  return { erro_mais_caro: p.costliest_error, na_duvida: p.uncertainty };
}

/** A versão da persona que este run usou. `null` quando não havia nenhuma. */
export function personaVersionOf(agent) {
  return agent?.persona?.persona_version ?? null;
}
