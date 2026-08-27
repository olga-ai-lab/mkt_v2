/**
 * Contenção de incidente: o kill switch e o caminho de rollback.
 *
 * A Mestra §34 manda conter com "feature flag / capability disable / rollback",
 * e o §46 lista "feature flag e caminho de rollback" como pré-requisito do
 * primeiro piloto. O AGT-MKT-COPILOT está ACTIVE desde a 0009 sem nada disso.
 *
 * ── Por que isto escreve POLICY, e não liga uma flag ───────────────────────
 *
 * Porque o mecanismo já existe. A policy é avaliada deterministicamente, é
 * escopada por capability, modo, agente, canal e risco, tem prioridade, e
 * "policy só restringe" é invariante de código com teste. Uma tabela de flags
 * ao lado seria um SEGUNDO lugar capaz de bloquear a mesma coisa — e "fórmula
 * duplicada em vários lugares" é anti-pattern que bloqueia aprovação (§47).
 *
 * O que este arquivo acrescenta não é poder de bloqueio: é a operação. Durante
 * um incidente ninguém escreve uma migration, e a diferença entre conter em
 * trinta segundos e conter em trinta minutos é o número de posts que saíram no
 * meio.
 *
 * ── Prioridade 0, e o motivo dela ──────────────────────────────────────────
 *
 * A policy de contenção entra com prioridade 0 — menor que qualquer uma
 * semeada, e menor vence. Uma contenção que perdesse para uma policy de
 * negócio seria uma contenção que não contém.
 *
 * ── O que ela NÃO faz ──────────────────────────────────────────────────────
 *
 * Não expira sozinha. `expires_at` existe e é lido pela tela e pelo runbook,
 * mas o runtime não apaga policy por conta própria: uma contenção que some
 * sozinha é uma contenção em que ninguém confia. Levantar é ato explícito, com
 * autor, como abaixar.
 *
 * E não desliga leitura. Degradar para read/suggest é o que o AGT-BASE §05
 * chama de "degradar quando for seguro" — um agente que só lê continua útil
 * enquanto o incidente é investigado.
 */

/** Só quem responde pelo workspace contém — e levantar exige o mesmo papel. */
export const PAPEIS_QUE_CONTEM = new Set(["OWNER"]);

export class ContainmentError extends Error {
  constructor(reason_code, message, status = 400) {
    super(message);
    this.reason_code = reason_code;
    this.status = status;
  }
}

/** Prefixo que distingue contenção de policy de negócio, na leitura e na lista. */
export const PREFIXO = "KILL_";

const exigirMotivo = (reason) => {
  const t = String(reason ?? "").trim();
  if (t.length < 10) {
    // Uma linha que bloqueia sem dizer por quê vira, duas semanas depois, uma
    // linha que ninguém sabe se pode remover.
    throw new ContainmentError("SCHEMA_VALIDATION_FAILED",
      "toda contencao precisa de motivo escrito", 400);
  }
  return t;
};

/**
 * @param {{ policies: any, tracer?: any, clock?: any }} deps
 *   `policies` precisa de `upsertContainment`, `liftContainment` e
 *   `listContainment` — as três escritas que só a contenção usa, separadas de
 *   `listActive` de propósito: quem lê policy para decidir não escreve policy.
 */
export function createContainmentService({ policies, tracer, clock } = {}) {
  if (!policies?.upsertContainment) {
    throw new Error("createContainmentService exige a porta policies.upsertContainment");
  }
  const agora = () => new Date(clock?.now?.() ?? Date.now()).toISOString();

  function exigirPapel(actor) {
    if (!PAPEIS_QUE_CONTEM.has(actor?.role)) {
      throw new ContainmentError("ACTOR_ROLE_FORBIDDEN",
        "conter ou levantar contencao e ato de dono do workspace", 403);
    }
  }

  async function aplicar({ tenant, actor, policy_id, scope, effect, max_autonomy,
                           reason, expires_at, trace_id }) {
    exigirPapel(actor);
    const motivo = exigirMotivo(reason);

    const r = await policies.upsertContainment({
      org_id: tenant.org_id,
      policy_id,
      // Prioridade 0: menor vence, e uma contenção que perde para uma policy de
      // negócio não contém.
      priority: 0,
      scope,
      effect,
      max_autonomy: max_autonomy ?? null,
      reason_code: effect === "BLOCK" ? "CAPABILITY_NOT_ACTIVE" : "AUTONOMY_EXCEEDED",
      message_key: effect === "BLOCK" ? "policy.contained" : "policy.degraded",
      reason: motivo,
      created_by: actor.id,
      expires_at: expires_at ?? null,
    });

    tracer?.event?.({
      trace_id, event: "containment.applied", policy_id, effect,
      scope, org_id: tenant.org_id, by: actor.id, reason: motivo, at: agora(),
    });
    return r;
  }

  return {
    /**
     * Kill switch: para TODA escrita do workspace.
     *
     * Uma linha, e não uma por capability — listar uma a uma durante um
     * incidente é como se esquece uma, e a que se esquece é a que continua
     * publicando.
     *
     * @param {{ tenant: object, actor: object, reason: string,
     *           expires_at?: string|null, trace_id?: string|null }} p
     */
    killWrites({ tenant, actor, reason, expires_at = null, trace_id = null }) {
      return aplicar({
        tenant, actor, reason, expires_at, trace_id,
        policy_id: `${PREFIXO}ALL_WRITES`,
        scope: { mode: "write" },
        effect: "BLOCK",
      });
    },

    /**
     * Para um agente inteiro, de qualquer modo.
     *
     * @param {{ tenant: object, actor: object, agent_id: string, reason: string,
     *           expires_at?: string|null, trace_id?: string|null }} p
     */
    killAgent({ tenant, actor, agent_id, reason, expires_at = null, trace_id = null }) {
      if (!agent_id) throw new ContainmentError("SCHEMA_VALIDATION_FAILED", "sem agent_id", 400);
      return aplicar({
        tenant, actor, reason, expires_at, trace_id,
        policy_id: `${PREFIXO}AGENT_${agent_id}`,
        scope: { agent_id },
        effect: "BLOCK",
      });
    },

    /**
     * Para uma capability, quando o problema é ela e não o agente.
     *
     * @param {{ tenant: object, actor: object, capability_id: string, reason: string,
     *           expires_at?: string|null, trace_id?: string|null }} p
     */
    killCapability({ tenant, actor, capability_id, reason, expires_at = null, trace_id = null }) {
      if (!capability_id) {
        throw new ContainmentError("SCHEMA_VALIDATION_FAILED", "sem capability_id", 400);
      }
      return aplicar({
        tenant, actor, reason, expires_at, trace_id,
        policy_id: `${PREFIXO}CAP_${capability_id}`,
        scope: { capability_id },
        effect: "BLOCK",
      });
    },

    /**
     * Degradar em vez de desligar (AGT-BASE §05: "degradar para read/suggest
     * quando for seguro").
     *
     * O teto vai para A1: o agente continua interpretando e explicando, e não
     * executa nada. Um agente que só lê continua útil enquanto o incidente é
     * investigado, e desligar tudo por precaução custa o produto inteiro.
     *
     * @param {{ tenant: object, actor: object, agent_id: string, reason: string,
     *           expires_at?: string|null, trace_id?: string|null }} p
     */
    degradeAgent({ tenant, actor, agent_id, reason, expires_at = null, trace_id = null }) {
      if (!agent_id) throw new ContainmentError("SCHEMA_VALIDATION_FAILED", "sem agent_id", 400);
      return aplicar({
        tenant, actor, reason, expires_at, trace_id,
        policy_id: `${PREFIXO}DEGRADE_${agent_id}`,
        scope: { agent_id },
        effect: "ALLOW",
        max_autonomy: "A1",
      });
    },

    /**
     * Levanta uma contenção. Mesmo papel de quem a aplicou, e também com motivo.
     *
     * @param {{ tenant: object, actor: object, policy_id: string, reason: string,
     *           trace_id?: string|null }} p
     */
    async lift({ tenant, actor, policy_id, reason, trace_id = null }) {
      exigirPapel(actor);
      const motivo = exigirMotivo(reason);
      if (!String(policy_id ?? "").startsWith(PREFIXO)) {
        // Sem isto, "levantar contenção" viraria um jeito de apagar policy de
        // negócio pela porta dos fundos.
        throw new ContainmentError("UNSUPPORTED_VALUE",
          "so contencao se levanta por aqui; policy de negocio muda por migration", 400);
      }

      const r = await policies.liftContainment({
        org_id: tenant.org_id, policy_id, lifted_by: actor.id, reason: motivo,
      });
      if (!r?.ok) {
        throw new ContainmentError("NORMALIZATION_FAILED",
          "nao encontrei essa contencao ativa neste workspace", 404);
      }
      tracer?.event?.({
        trace_id, event: "containment.lifted", policy_id,
        org_id: tenant.org_id, by: actor.id, reason: motivo, at: agora(),
      });
      return r;
    },

    /** O que está contido agora, e desde quando. */
    list({ tenant }) {
      return policies.listContainment(tenant.org_id);
    },
  };
}
