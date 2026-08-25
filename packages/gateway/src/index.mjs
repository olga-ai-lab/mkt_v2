/**
 * Capability Gateway.
 *
 * Unica porta por onde passa qualquer efeito colateral. Implementa os oito
 * passos do MKT-09B §10, nesta ordem, sem atalho:
 *
 *   1. capability ACTIVE no registry
 *   2. tenant + RBAC do ator
 *   3. policy / autonomia / risco / materialidade / aprovacao
 *   4. idempotencia e dedup ANTES do efeito
 *   5. selecao de adapter / provider / connection
 *   6. timeout / retry classificado
 *   7. normalizacao de output e erro
 *   8. emissao do ActionReceipt
 *
 * As dependencias entram por porta (registry, policies, receipts, adapters,
 * clock, tracer). Isso permite testar o gateway inteiro sem banco e sem rede,
 * e trocar o adapter real por um falso enquanto o app review da Meta nao sai.
 */
import { assertValid, validate, autonomyRank } from "@olga/contracts";
import { evaluate } from "@olga/policy";

export class CapabilityError extends Error {
  constructor(reason_code, message, extra = {}) {
    super(message ?? reason_code);
    this.reason_code = reason_code;
    Object.assign(this, extra);
  }
}

const nowIso = (clock) => new Date(clock?.now?.() ?? Date.now()).toISOString();

function normalizeError(e) {
  if (e instanceof CapabilityError) {
    return { class: e.error_class ?? "PERMANENT", reason_code: e.reason_code, retryable: e.retryable ?? false,
             provider_message: e.provider_message };
  }
  // Erro desconhecido nunca vira sucesso e nunca vira retry infinito.
  return { class: "PERMANENT", reason_code: "PROVIDER_UNAVAILABLE", retryable: false, provider_message: String(e?.message ?? e) };
}

/** Constroi a idempotency key a partir do template declarado no registry. */
export function buildIdempotencyKey(template, ctx) {
  if (!template) return null;
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = ctx[k];
    if (v == null || v === "") throw new CapabilityError("SCHEMA_VALIDATION_FAILED", `idempotency_key: falta "${k}"`);
    return String(v);
  });
}

export function createGateway({ registry, policies, receipts, adapters, clock, tracer }) {
  /**
   * @returns {{ execution: ExecutionResult, respondability: RespondabilityResult, receipt?: ActionReceipt }}
   */
  async function execute(request, { facts = {}, actor } = {}) {
    const started_at = nowIso(clock);
    const trace_id = request.trace_id;

    // --- 1. Contrato de entrada e capability ACTIVE ------------------------
    assertValid("olga://io/capability-request", request);

    const cap = await registry.getCapability(request.capability_id, request.capability_version);
    if (!cap) throw new CapabilityError("CAPABILITY_NOT_ACTIVE", `capability desconhecida: ${request.capability_id}`);
    if (cap.status !== "ACTIVE") {
      throw new CapabilityError("CAPABILITY_NOT_ACTIVE", `capability ${request.capability_id} esta ${cap.status}`);
    }
    if (cap.mode !== request.mode) {
      throw new CapabilityError("SCHEMA_VALIDATION_FAILED", `mode divergente: pedido ${request.mode}, registry ${cap.mode}`);
    }

    // --- 2. Tenant e RBAC --------------------------------------------------
    if (!actor?.role) throw new CapabilityError("ACTOR_ROLE_FORBIDDEN", "ator sem papel");
    if (actor.org_id && actor.org_id !== request.tenant.org_id) {
      throw new CapabilityError("TENANT_SCOPE_VIOLATION", "ator fora do tenant do pedido");
    }
    if (!cap.permissions.includes(actor.role)) {
      throw new CapabilityError("ACTOR_ROLE_FORBIDDEN", `papel ${actor.role} nao pode ${cap.capability_id}`);
    }

    // --- 3. Policy gate ----------------------------------------------------
    const respondability = evaluate({
      trace_id,
      context: {
        capability_id: cap.capability_id,
        capability_mode: cap.mode,
        channel: request.args?.channel ?? null,
        agent_id: request.args?.agent_id ?? null,
        risk_tier: cap.risk_tier,
      },
      facts,
      requested_autonomy: request.requested_autonomy ?? "A2",
      policies: await policies.listActive(request.tenant.org_id),
    });

    if (respondability.state === "POLICY_BLOCKED") {
      return { respondability, execution: blocked(cap, respondability, started_at, clock, trace_id) };
    }
    if (respondability.state === "APPROVAL_REQUIRED" && !request.approval_id) {
      return { respondability, execution: blocked(cap, respondability, started_at, clock, trace_id) };
    }
    if (request.approval_id) {
      const ok = await registry.isApprovalValid?.(request.approval_id, request.args);
      if (ok === false) {
        const r = { ...respondability, state: "APPROVAL_REQUIRED", reason_codes: [...respondability.reason_codes, "CONTENT_NOT_APPROVED"] };
        return { respondability: r, execution: blocked(cap, r, started_at, clock, trace_id) };
      }
    }
    // A autonomia concedida nunca pode ficar acima do teto do agente.
    if (respondability.granted_autonomy &&
        autonomyRank(respondability.granted_autonomy) > autonomyRank(cap.max_autonomy ?? "A4")) {
      respondability.granted_autonomy = cap.max_autonomy;
    }

    // --- 4. Idempotencia ANTES de qualquer efeito --------------------------
    let idem = request.idempotency_key;
    if (cap.side_effect === "external") {
      if (!cap.idempotency?.required) {
        throw new CapabilityError("SCHEMA_VALIDATION_FAILED",
          `capability externa ${cap.capability_id} sem idempotencia declarada`);
      }
      idem = idem ?? buildIdempotencyKey(cap.idempotency.key_template, { ...request.tenant, ...request.args });

      const existing = await receipts.find(request.tenant.org_id, cap.capability_id, idem);
      if (existing) {
        // Replay. Devolve o efeito ja realizado; nao chama o provider de novo.
        tracer?.event?.({ trace_id, event: "capability.deduplicated", capability_id: cap.capability_id, idempotency_key: idem });
        return {
          respondability,
          execution: {
            trace_id, capability_id: cap.capability_id, status: "DEDUPLICATED",
            provider: existing.provider ?? null, external_id: existing.external_id ?? null,
            error: null, attempts: 0, started_at, finished_at: nowIso(clock),
          },
          receipt: existing,
        };
      }
    }

    // --- 5, 6, 7. Adapter, retry classificado, normalizacao ----------------
    const adapter = adapters[cap.provider_adapter ?? "internal"];
    if (!adapter) throw new CapabilityError("PROVIDER_UNAVAILABLE", `sem adapter para ${cap.provider_adapter}`);

    const maxAttempts = cap.retry_policy?.max_attempts ?? cap.max_attempts ?? 1;
    let attempts = 0, out = null, err = null;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        out = await adapter.call({ capability: cap, request, idempotency_key: idem, trace_id });
        err = null;
        break;
      } catch (e) {
        err = normalizeError(e);
        tracer?.event?.({ trace_id, event: "capability.attempt_failed", attempt: attempts, reason_code: err.reason_code });
        if (!err.retryable) break;       // erro permanente nao insiste
        if (attempts >= maxAttempts) break;
      }
    }

    const finished_at = nowIso(clock);
    const execution = {
      trace_id, capability_id: cap.capability_id,
      status: err ? "FAILED" : "SUCCEEDED",
      provider: cap.provider_adapter ?? null,
      external_id: out?.external_id ?? null,
      error: err, attempts, started_at, finished_at,
    };
    assertValid("olga://io/execution-result", execution);

    // --- 8. Receipt para todo efeito material ------------------------------
    let receipt;
    if (cap.side_effect === "external") {
      receipt = {
        receipt_id: registry.newId(),
        trace_id, tenant: request.tenant,
        capability_id: cap.capability_id,
        idempotency_key: idem,
        request_hash: out?.request_hash ?? null,
        provider: cap.provider_adapter ?? null,
        external_id: out?.external_id ?? null,
        status: err ? "FAILED" : "EFFECTED",
        autonomy_used: respondability.granted_autonomy ?? "A2",
        approval_id: request.approval_id ?? null,
        recorded_at: finished_at,
      };
      assertValid("olga://io/action-receipt", receipt);
      await receipts.save(receipt);
    }

    tracer?.event?.({ trace_id, event: "capability.completed", capability_id: cap.capability_id,
                      status: execution.status, attempts, autonomy: respondability.granted_autonomy });

    return { respondability, execution, receipt };
  }

  return { execute };
}

function blocked(cap, respondability, started_at, clock, trace_id) {
  const execution = {
    trace_id, capability_id: cap.capability_id, status: "BLOCKED",
    provider: null, external_id: null,
    error: {
      class: "POLICY",
      reason_code: respondability.reason_codes[0] ?? "NO_ACTIVE_POLICY",
      retryable: false,
    },
    attempts: 0, started_at, finished_at: nowIso(clock),
  };
  const { valid, errors } = validate("olga://io/execution-result", execution);
  if (!valid) throw new Error(`execution-result invalido: ${JSON.stringify(errors)}`);
  return execution;
}
