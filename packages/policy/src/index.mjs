/**
 * Policy Engine deterministico.
 *
 * Fecha os achados G1 e G7 do MKT-17.
 *
 * Duas camadas, nesta ordem:
 *   1. INVARIANTES  - hard-coded, nao configuraveis, nunca afrouxaveis por dado.
 *   2. RULE POLICIES - dados tipados em governance.rule_policies, avaliados por
 *                      prioridade crescente; a primeira correspondencia decide.
 *
 * Regra estrutural: policy so pode RESTRINGIR. Nenhuma linha de banco consegue
 * conceder mais autonomia do que o invariante ou do que a matriz risco x autonomia.
 * Default deny para qualquer capability de escrita sem policy ACTIVE correspondente.
 */
import { MAX_AUTONOMY_BY_RISK, autonomyRank, POLICY_FACTS } from "@olga/contracts";

const OPS = {
  eq: (a, b) => a === b,
  neq: (a, b) => a !== b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  not_in: (a, b) => Array.isArray(b) && !b.includes(a),
  gt: (a, b) => typeof a === "number" && a > b,
  gte: (a, b) => typeof a === "number" && a >= b,
  lt: (a, b) => typeof a === "number" && a < b,
  lte: (a, b) => typeof a === "number" && a <= b,
  contains_any: (a, b) => Array.isArray(a) && Array.isArray(b) && a.some((x) => b.includes(x)),
  is_true: (a) => a === true,
  is_false: (a) => a === false,
};

/** Autonomia mais restritiva entre duas. */
export function minAutonomy(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return autonomyRank(a) <= autonomyRank(b) ? a : b;
}

/**
 * Invariantes do MKT-17 §5.1. Retornam o teto de autonomia e um reason code.
 * Nunca dependem de dado configuravel.
 */
export const INVARIANTS = [
  {
    id: "INV_FIRST_PUBLISH",
    when: (f) => f.workspace_first_publish === true,
    ceiling: "A3",
    reason_code: "WORKSPACE_FIRST_PUBLISH",
    note: "A primeira publicacao de um workspace nunca sai em autopilot.",
  },
  {
    id: "INV_MATERIAL_CLAIM",
    when: (f) => Array.isArray(f.claim_types) && f.claim_types.some((c) => ["COVERAGE", "PRICE", "DEADLINE"].includes(c)),
    ceiling: "A2",
    reason_code: "COMPLIANCE_REVIEW_REQUIRED",
    note: "Claim de cobertura, preco ou prazo exige revisao humana.",
  },
  {
    id: "INV_EVIDENCE",
    when: (f) => f.evidence_coverage === false,
    ceiling: "A2",
    reason_code: "EVIDENCE_INSUFFICIENT",
    note: "Claim material sem evidence nao vira efeito externo.",
  },
  {
    id: "INV_BRAND_BRAIN",
    when: (f) => f.brand_brain_status != null && f.brand_brain_status !== "ACTIVE",
    ceiling: "A2",
    reason_code: "BRAND_BRAIN_NOT_ACTIVE",
    note: "Sem Brand Brain ACTIVE o agente so rascunha.",
  },
  {
    id: "INV_CONSENT",
    when: (f) => f.consent_status != null && f.consent_status !== "GRANTED",
    ceiling: "A0",
    reason_code: "CONSENT_MISSING",
    note: "Envio a contato sem consent ativo para o canal e bloqueado, em qualquer nivel.",
  },
  {
    id: "INV_CHANNEL",
    when: (f) => f.channel_connected === false,
    ceiling: "A1",
    reason_code: "CHANNEL_NOT_CONNECTED",
    note: "Sem conexao valida nao ha efeito externo possivel.",
  },
  {
    id: "INV_CONTENT_APPROVED",
    when: (f) => f.content_status != null && !["APPROVED", "SCHEDULED", "PUBLISHING"].includes(f.content_status),
    ceiling: "A2",
    reason_code: "CONTENT_NOT_APPROVED",
    note: "Conteudo nao aprovado nao publica. Alteracao apos aprovacao derruba o estado.",
  },
];

/**
 * O escopo casa quando TODA chave declarada bate. Chave ausente nao restringe.
 *
 * `mode` entrou por ultimo, e para uma coisa so: o kill switch de escrita do
 * §34 da Mestra precisa caber numa linha — `{mode: "write"}` com efeito BLOCK
 * contem toda escrita de uma vez. Listar capability por capability durante um
 * incidente e como se esquece uma, e a que se esquece e a que continua
 * publicando.
 */
function scopeMatches(policy, ctx) {
  const s = policy.scope ?? {};
  for (const key of ["capability_id", "capability_mode", "channel", "agent_id", "risk_tier"]) {
    // O contrato chama de `mode`; o contexto de avaliacao chama de
    // `capability_mode`. Aceitar os dois nomes aqui evita renomear um campo que
    // ja esta em uso no gateway e no loop.
    const declarado = key === "capability_mode" ? (s.mode ?? s.capability_mode) : s[key];
    if (declarado != null && declarado !== ctx[key]) return false;
  }
  return true;
}

function conditionsMatch(policy, facts) {
  for (const c of policy.conditions ?? []) {
    if (!POLICY_FACTS.includes(c.fact)) {
      throw new Error(`policy ${policy.policy_id}: fato desconhecido "${c.fact}"`);
    }
    const op = OPS[c.op];
    if (!op) throw new Error(`policy ${policy.policy_id}: operador desconhecido "${c.op}"`);
    if (!op(facts[c.fact], c.value)) return false;
  }
  return true;
}

/**
 * @param {object} input
 * @param {object} input.context  { capability_id, capability_mode, channel, agent_id, risk_tier }
 * @param {object} input.facts    fatos do enum policy-fact
 * @param {string} input.requested_autonomy
 * @param {Array}  input.policies RulePolicy[] (qualquer status; so ACTIVE conta)
 * @param {string} input.trace_id
 * @returns RespondabilityResult
 */
export function evaluate({ context, facts = {}, requested_autonomy = "A2", policies = [], trace_id = "trace" }) {
  const applied = [];
  const reason_codes = [];

  // Teto 1: matriz risco x autonomia (MKT-17 §5.1).
  let ceiling = MAX_AUTONOMY_BY_RISK[context.risk_tier] ?? "A2";

  // Teto 2: invariantes. Podem apenas baixar o teto.
  for (const inv of INVARIANTS) {
    if (inv.when(facts)) {
      const next = minAutonomy(ceiling, inv.ceiling);
      if (next !== ceiling || !reason_codes.includes(inv.reason_code)) reason_codes.push(inv.reason_code);
      ceiling = next;
      applied.push({ policy_id: inv.id, version: 0 });
    }
  }

  const isWrite = context.capability_mode === "write";

  // Camada 3: rule policies ACTIVE, prioridade crescente, primeira correspondencia decide.
  const candidates = policies
    .filter((p) => p.status === "ACTIVE")
    .filter((p) => scopeMatches(p, context))
    .sort((a, b) => a.priority - b.priority || a.policy_id.localeCompare(b.policy_id));

  const matched = candidates.find((p) => conditionsMatch(p, facts));

  const base = {
    trace_id,
    evaluated_at: new Date().toISOString(),
    policy_versions: applied,
  };

  if (!matched) {
    // Default deny para escrita. Leitura e simulacao seguem sem policy explicita.
    if (isWrite) {
      return {
        ...base,
        state: "POLICY_BLOCKED",
        reason_codes: [...reason_codes, "NO_ACTIVE_POLICY"],
        granted_autonomy: null,
        required_approval: false,
        user_message_key: "policy.no_active_policy",
      };
    }
    return {
      ...base,
      state: "EXECUTABLE",
      reason_codes,
      granted_autonomy: minAutonomy(requested_autonomy, ceiling),
      required_approval: false,
      user_message_key: "policy.read_allowed",
    };
  }

  base.policy_versions = [...applied, { policy_id: matched.policy_id, version: matched.version }];

  if (matched.effect === "BLOCK") {
    return {
      ...base,
      state: "POLICY_BLOCKED",
      reason_codes: [...reason_codes, matched.reason_code].filter(Boolean),
      granted_autonomy: null,
      required_approval: false,
      user_message_key: matched.message_key ?? "policy.blocked",
    };
  }

  // Teto 3: a policy tambem so restringe.
  const finalCeiling = minAutonomy(ceiling, matched.max_autonomy ?? ceiling);

  if (matched.effect === "REQUIRE_APPROVAL") {
    return {
      ...base,
      state: "APPROVAL_REQUIRED",
      reason_codes: [...reason_codes, matched.reason_code].filter(Boolean),
      granted_autonomy: minAutonomy("A3", finalCeiling),
      required_approval: true,
      user_message_key: matched.message_key ?? "policy.approval_required",
    };
  }

  // ALLOW
  if (autonomyRank(requested_autonomy) > autonomyRank(finalCeiling)) {
    // Pediu mais do que o teto. Nao rebaixa em silencio quando ha efeito externo:
    // efeito externo vira aprovacao; leitura/rascunho apenas rebaixa com reason code.
    if (isWrite) {
      return {
        ...base,
        state: "APPROVAL_REQUIRED",
        reason_codes: [...reason_codes, "AUTONOMY_EXCEEDED"],
        granted_autonomy: finalCeiling,
        required_approval: true,
        user_message_key: "policy.autonomy_exceeded",
      };
    }
    return {
      ...base,
      state: "EXECUTABLE",
      reason_codes: [...reason_codes, "AUTONOMY_EXCEEDED"],
      granted_autonomy: finalCeiling,
      required_approval: false,
      user_message_key: "policy.autonomy_downgraded",
    };
  }

  return {
    ...base,
    state: "EXECUTABLE",
    reason_codes,
    granted_autonomy: requested_autonomy,
    required_approval: false,
    user_message_key: matched.message_key ?? "policy.allowed",
  };
}
