/**
 * O delta de cada agente.
 *
 * O AGT-BASE diz o que fica no delta e nada mais: charter, contratos, casos de
 * teste específicos e desvios explícitos da base. Três dessas quatro coisas já
 * existem como DADO, em `mkt.agent_registry` — missão, capabilities, reason
 * codes, autonomia, `deviates_from_base`. Os casos de teste golden e
 * adversarial ficam para a Fase 2, construídos junto das corretoras piloto
 * (MKT-17, achado G11).
 *
 * Então o que sobra para este arquivo é só o que não cabe numa coluna: a
 * política de incerteza. O que o agente faz quando não tem certeza.
 *
 * ── Por que ele é uma camada fina, e não uma segunda definição ─────────────
 *
 * Missão, capabilities e reason codes NÃO são reescritos aqui. Eles são lidos
 * da linha do registry e projetados no prompt. Se estivessem escritos nos dois
 * lugares, um dia divergiriam — e o prompt venceria na prática enquanto o
 * registry venceria na policy, que é a pior divergência possível: o agente
 * agiria por uma regra e seria julgado por outra.
 *
 * Há teste afirmando que nenhum delta cita capability que o agente não tem.
 *
 * ── Erro mais caro ─────────────────────────────────────────────────────────
 *
 * O AGT-BASE, no gate G0 do ciclo de vida, pergunta "qual erro custa mais".
 * A resposta não é decorativa: é ela que decide para que lado o agente erra
 * quando está inseguro. Cada `erro_mais_caro` abaixo é derivado dos reason
 * codes que a própria linha do registry declara — não inventado.
 */

/**
 * Política de incerteza por agente.
 *
 * `erro_mais_caro` e `na_duvida` são o par que importa: o segundo é a
 * consequência operacional do primeiro.
 */
const DELTAS = {
  "AGT-MKT-COPILOT": {
    erro_mais_caro:
      "agir quando deveria ter perguntado, mandando o pedido para o especialista errado",
    na_duvida:
      "pergunte. Você é a porta de entrada: um pedido mal roteado custa uma rodada inteira " +
      "de trabalho do especialista errado. Prefira uma pergunta curta a um palpite.",
  },

  "AGT-MKT-BRAND": {
    erro_mais_caro:
      "registrar como fato da marca algo que o site não sustenta, porque todo conteúdo " +
      "gerado depois herda o erro",
    na_duvida:
      "deixe o campo vazio e marque a fonte como insuficiente. Um Brand Brain com lacuna " +
      "é corrigível; um com afirmação errada contamina tudo que vem depois e ninguém " +
      "percebe a origem.",
  },

  "AGT-MKT-CONTENT": {
    erro_mais_caro:
      "publicar uma afirmação sobre cobertura, preço ou prazo que a evidência não sustenta",
    na_duvida:
      "escreva sem a afirmação. Texto mais fraco se conserta na revisão; claim sem " +
      "evidência publicado no perfil do cliente vira problema de compliance dele, não seu.",
  },

  "AGT-MKT-COMPLIANCE": {
    erro_mais_caro:
      "deixar passar um claim que não deveria passar — o falso negativo custa mais que " +
      "o falso positivo",
    na_duvida:
      "marque para revisão humana. Barrar conteúdo bom atrasa uma publicação; liberar " +
      "conteúdo errado não tem desfazer depois que foi ao ar.",
  },
};

/** Fallback para agente sem delta próprio: a postura mais conservadora. */
const PADRAO = {
  erro_mais_caro: "agir além do que foi pedido",
  na_duvida: "pare e pergunte. Nenhum agente deste sistema erra para o lado de agir mais.",
};

/**
 * Monta o texto do delta a partir da linha do registry.
 *
 * Note que missão, capabilities e reason codes vêm do argumento `agent` — ou
 * seja, do banco. Este arquivo não os conhece.
 */
export function deltaFor(agent) {
  const d = DELTAS[agent?.agent_id] ?? PADRAO;
  const capabilities = agent?.capabilities ?? [];
  const reasonCodes = agent?.reason_codes ?? [];
  const desvios = agent?.deviates_from_base ?? [];

  const linhas = [
    `Você é ${agent?.agent_id}.`,
    `Missão: ${agent?.mission ?? "não declarada"}`,
    capabilities.length
      ? `Você só pode propor estas capabilities: ${capabilities.join(", ")}.`
      : "Você não tem capability de escrita: apenas interprete e explique.",
    "",
    `O erro que custa mais caro no seu papel: ${d.erro_mais_caro}.`,
    `Na dúvida: ${d.na_duvida}`,
  ];

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

  return linhas.join("\n");
}

/** Só a política, para quem quiser montar o próprio texto. */
export function uncertaintyPolicy(agent_id) {
  return DELTAS[agent_id] ?? PADRAO;
}

/** Os agentes que têm delta próprio. Usado no teste de cobertura. */
export const AGENTS_COM_DELTA = Object.keys(DELTAS);
