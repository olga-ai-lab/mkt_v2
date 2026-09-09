/**
 * Geracao em lote (C2): N briefs, um agente, e um freio.
 *
 * Esta e a unica parte do produto em que um clique gasta dinheiro N vezes.
 * Tudo aqui e sobre isso.
 *
 * ── Por que ele PARA em vez de continuar ──────────────────────────────────
 *
 * O Model Gateway ja recusa sem orcamento (`BUDGET_NOT_CONFIGURED`) e acima do
 * teto (`SPEND_LIMIT_EXCEEDED`). O que faltava era o lote OBEDECER a recusa: um
 * laco ingenuo receberia a primeira e tentaria os dezenove seguintes, gastando
 * a chamada de rede de cada um para colher a mesma negativa — ou, pior, no caso
 * do teto por chamada, gastando de verdade ate o orcamento acabar.
 *
 * Entao a recusa de orcamento e TERMINAL para o lote. As outras nao: um brief
 * ambiguo, um claim sem lastro, um agente que pediu esclarecimento — esses sao
 * resultado daquele item, e o proximo pode passar bem.
 *
 * ── Por que sequencial ────────────────────────────────────────────────────
 *
 * Paralelo seria mais rapido e tornaria o freio decorativo: quando a primeira
 * recusa chegasse, as outras dezenove ja teriam sido enviadas. Um lote de
 * conteudo nao tem pressa que justifique isso.
 */

/** Recusas que valem para o LOTE inteiro, e nao so para um item. */
export const RECUSAS_TERMINAIS = new Set([
  "BUDGET_NOT_CONFIGURED",
  "SPEND_LIMIT_EXCEEDED",
  // Sem provider ou sem rota, o proximo item falha igual. Insistir so gera
  // ruido no trace de vinte execucoes identicas.
  "PROVIDER_UNAVAILABLE",
  "MODEL_ROUTE_NOT_ACTIVE",
  // Tenant e papel nao mudam no meio do lote.
  "TENANT_SCOPE_VIOLATION",
  "ACTOR_ROLE_FORBIDDEN",
  "AGENT_NOT_ACTIVE",
]);

/** Teto de itens por lote. Acima disto, o pedido e recusado antes de gastar. */
export const MAX_POR_LOTE = 20;

export class BatchError extends Error {
  constructor(reason_code, message) {
    super(message);
    this.reason_code = reason_code;
  }
}

/**
 * @param {{ agentLoop: { run: Function } }} deps
 */
export function createBatchRunner({ agentLoop }) {
  if (!agentLoop) throw new Error("createBatchRunner exige um agentLoop");

  /**
   * @param {{ tenant: object, actor: object, agent_id: string,
   *           briefs: string[], internal?: boolean }} pedido
   * @returns {Promise<{ itens: Array, interrompido: string|null }>}
   */
  return async function rodar({ tenant, actor, agent_id, briefs, internal = false }) {
    const limpos = (briefs ?? []).map((b) => String(b ?? "").trim()).filter(Boolean);

    if (limpos.length === 0) {
      throw new BatchError("SCHEMA_VALIDATION_FAILED", "lote sem nenhum brief");
    }
    if (limpos.length > MAX_POR_LOTE) {
      // Recusado ANTES de gastar o primeiro centavo. Um teto conferido no meio
      // do laco ja teria custado os itens anteriores.
      throw new BatchError("UNSUPPORTED_VALUE",
        `lote de ${limpos.length} itens acima do teto de ${MAX_POR_LOTE}`);
    }

    const itens = [];
    let interrompido = null;

    for (const [i, text] of limpos.entries()) {
      if (interrompido) {
        // Os que sobraram nao foram tentados, e a tela precisa dizer isso em
        // vez de deixar a pessoa achar que falharam.
        itens.push({ indice: i, brief: text, estado: "NAO_TENTADO" });
        continue;
      }

      try {
        const r = await agentLoop.run({
          tenant, actor, agent_id, input: { text }, internal,
        });
        const reason_codes = r.response?.reason_codes ?? [];
        itens.push({
          indice: i, brief: text, estado: "EXECUTADO",
          trace_id: r.trace_id, run_id: r.run_id,
          respondability: r.response?.respondability ?? null,
          message: r.response?.message ?? null,
          reason_codes,
        });

        // Uma recusa terminal pode chegar como resposta, sem excecao — o loop
        // encerra com reason code em vez de levantar quando a policy para.
        const terminal = reason_codes.find((c) => RECUSAS_TERMINAIS.has(c));
        if (terminal) interrompido = terminal;
      } catch (e) {
        const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
        itens.push({ indice: i, brief: text, estado: "FALHOU", reason_codes: [reason_code] });
        if (RECUSAS_TERMINAIS.has(reason_code)) interrompido = reason_code;
      }
    }

    return { itens, interrompido };
  };
}
