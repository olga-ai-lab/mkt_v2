/**
 * Model Gateway.
 *
 * Implementa o MKT-09B §8. Cinco propriedades que o documento exige e que este
 * arquivo trata como invariante, nao como configuracao:
 *
 *   1. Rota por task class, vinda de registry versionado — nao de if/else.
 *   2. Fallback EXPLICITO. Nunca silencioso em decisao material.
 *   3. Budget por workspace verificado ANTES da chamada, nao depois da conta.
 *   4. Token, custo, latencia e motivo do fallback sempre no trace.
 *   5. Model profile e configuracao governada, com status; CANDIDATE nao roda.
 *
 * O frontend nunca fala com provider. Fala com isto.
 */
import { assertValid } from "@olga/contracts";

export class ModelError extends Error {
  constructor(reason_code, message, extra = {}) {
    super(message ?? reason_code);
    this.reason_code = reason_code;
    Object.assign(this, extra);
  }
}

/** Preco em centavos por 1M de tokens. Tabela e dado, nao constante espalhada. */
export function estimateCostCents({ input_tokens = 0, output_tokens = 0, price }) {
  if (!price) return null;
  const cents =
    (input_tokens / 1_000_000) * price.input_cents_per_mtok +
    (output_tokens / 1_000_000) * price.output_cents_per_mtok;
  return Math.round(cents * 10_000) / 10_000;
}

const isTransient = (e) =>
  e?.transient === true ||
  ["ETIMEDOUT", "ECONNRESET", "rate_limit", "overloaded", "503", "529"].some((s) =>
    String(e?.code ?? e?.message ?? "").includes(s));

/**
 * @param {{ routing: any, providers: any, budget: any, tracer?: any, clock?: any }} deps
 */
export function createModelGateway({ routing, providers, budget, tracer, clock }) {
  const now = () => clock?.now?.() ?? Date.now();

  /**
   * @param {object} req
   * @param {string} req.task_class
   * @param {object} req.tenant           { org_id, workspace_id }
   * @param {string} req.trace_id
   * @param {Array}  req.messages
   * @param {string} [req.schema_ref]     valida a saida contra um schema do olga-contracts
   * @param {boolean}[req.material]       decisao material: fallback exige opt-in explicito
   * @param {boolean}[req.allow_fallback_on_material]
   * @param {number} [req.max_cost_cents] teto desta chamada; o menor entre este e o da rota vence
   */
  async function complete(req) {
    const started = now();
    const { task_class, tenant, trace_id } = req;

    // --- 1. Rota governada ------------------------------------------------
    const route = await routing.getRoute(task_class);
    if (!route) throw new ModelError("MODEL_ROUTE_NOT_ACTIVE", `sem rota para task_class "${task_class}"`);
    if (route.status !== "ACTIVE") {
      throw new ModelError("MODEL_ROUTE_NOT_ACTIVE", `rota de ${task_class} esta ${route.status}`);
    }

    // --- 2. Orcamento antes da chamada ------------------------------------
    const ceiling = Math.min(
      req.max_cost_cents ?? Number.POSITIVE_INFINITY,
      route.max_cost_cents ?? Number.POSITIVE_INFINITY,
    );
    const remaining = await budget.remainingCents(tenant.workspace_id);
    if (remaining == null) {
      throw new ModelError("BUDGET_NOT_CONFIGURED", `workspace ${tenant.workspace_id} sem orcamento definido`);
    }
    if (remaining <= 0) {
      throw new ModelError("SPEND_LIMIT_EXCEEDED", "orcamento do workspace esgotado", { remaining_cents: remaining });
    }

    // --- 3. Cadeia de tentativa: primario, depois fallbacks autorizados ----
    const chain = [route.primary];
    const fallbackPermitido = !req.material || req.allow_fallback_on_material === true;
    if (fallbackPermitido) chain.push(...(route.fallback ?? []));

    let lastError = null;
    let fallback_used = false;
    let fallback_reason = null;

    for (let i = 0; i < chain.length; i++) {
      const target = chain[i];
      const provider = providers[target.provider];
      if (!provider) { lastError = new ModelError("PROVIDER_UNAVAILABLE", `sem provider "${target.provider}"`); continue; }

      try {
        const out = await provider.complete({
          model: target.model,
          messages: req.messages,
          timeout_ms: route.timeout_ms ?? 60_000,
          trace_id,
        });

        const cost_cents = estimateCostCents({
          input_tokens: out.input_tokens, output_tokens: out.output_tokens, price: target.price,
        });

        // Teto por chamada: estourou, o resultado nao e aproveitado em silencio.
        if (cost_cents != null && cost_cents > ceiling) {
          await budget.record({ workspace_id: tenant.workspace_id, cost_cents, trace_id, task_class });
          throw new ModelError("SPEND_LIMIT_EXCEEDED",
            `chamada custou ${cost_cents} centavos, acima do teto ${ceiling}`, { cost_cents });
        }

        // --- 4. Saida estruturada -----------------------------------------
        let parsed = null;
        if (req.schema_ref) {
          try {
            parsed = typeof out.content === "string" ? JSON.parse(out.content) : out.content;
          } catch {
            throw new ModelError("MODEL_OUTPUT_INVALID", "saida nao e JSON valido");
          }
          assertValid(req.schema_ref, parsed);   // lanca SCHEMA_VALIDATION_FAILED
        }

        await budget.record({ workspace_id: tenant.workspace_id, cost_cents, trace_id, task_class });

        const result = {
          trace_id, task_class,
          provider: target.provider, model: target.model,
          model_profile_version: route.version,
          content: out.content, parsed,
          input_tokens: out.input_tokens ?? null,
          output_tokens: out.output_tokens ?? null,
          cost_cents,
          latency_ms: now() - started,
          cached: out.cached === true,
          fallback_used, fallback_reason,
        };

        tracer?.event?.({ ...result, event: "model.completed", content: undefined, parsed: undefined });
        return result;
      } catch (e) {
        // Erro de contrato ou de orcamento nao vira tentativa no proximo modelo:
        // trocar de modelo nao conserta schema errado nem verba esgotada.
        if (["SCHEMA_VALIDATION_FAILED", "MODEL_OUTPUT_INVALID", "SPEND_LIMIT_EXCEEDED"].includes(e.reason_code)) throw e;

        lastError = e;
        const podeSeguir = i + 1 < chain.length && isTransient(e);
        tracer?.event?.({
          trace_id, event: "model.attempt_failed", provider: target.provider, model: target.model,
          reason: String(e.message), will_fallback: podeSeguir,
        });
        if (!podeSeguir) break;
        fallback_used = true;
        fallback_reason = e.reason_code ?? e.code ?? String(e.message).slice(0, 80);
      }
    }

    // Fallback recusado numa decisao material: isso e informacao, nao ruido.
    if (req.material && !fallbackPermitido && lastError) {
      throw new ModelError("PROVIDER_UNAVAILABLE",
        "primario indisponivel e fallback nao autorizado para decisao material",
        { cause_reason: lastError.reason_code ?? null });
    }
    throw lastError ?? new ModelError("PROVIDER_UNAVAILABLE", "nenhum provider respondeu");
  }

  return { complete };
}
