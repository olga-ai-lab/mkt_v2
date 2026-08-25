/**
 * Agent Runtime.
 *
 * O que este arquivo garante, e que o MKT-09B §5 exige do Context Manager e do
 * Agent Router:
 *
 *   - org_id e workspace_id sao ligados FORA do LLM e revalidados no servidor.
 *     O input do usuario nunca escolhe o tenant. Se tentar, e violacao.
 *   - Agente CANDIDATE roda apenas em modo interno e limitado ao baseline.
 *     Rollout e offline -> shadow -> interno -> piloto, nao um interruptor.
 *   - Toda execucao vira uma linha em agent_runs com custo, tokens e latencia.
 *     Custo por run instrumentado desde o primeiro dia (achado G12 do MKT-17).
 *   - Falha nao apaga o run. O registro fica com o motivo.
 */
import { assertValid, autonomyRank } from "@olga/contracts";
import { ModelError } from "./model-gateway.mjs";

export class RuntimeError extends Error {
  constructor(reason_code, message, extra = {}) {
    super(message ?? reason_code);
    this.reason_code = reason_code;
    Object.assign(this, extra);
  }
}

export function createAgentRuntime({ modelGateway, registry, runs, tracer, clock, ids }) {
  const now = () => clock?.now?.() ?? Date.now();

  /**
   * @param {object} req
   * @param {object} req.tenant   { org_id, workspace_id }  — vem da sessao, nunca do corpo
   * @param {object} req.actor    { id, role, org_id }
   * @param {string} req.agent_id
   * @param {object} req.input    { text?, refs? } — conteudo do usuario, sem autoridade
   * @param {boolean}[req.internal] permite rodar agente CANDIDATE
   */
  async function run(req) {
    const trace_id = req.trace_id ?? ids.newTraceId();
    const started_at = now();

    // --- Tenant binding fora do LLM ---------------------------------------
    const { tenant, actor } = req;
    if (!tenant?.org_id || !tenant?.workspace_id) {
      throw new RuntimeError("TENANT_SCOPE_VIOLATION", "tenant ausente no contexto confiavel");
    }
    if (!actor?.role) throw new RuntimeError("ACTOR_ROLE_FORBIDDEN", "ator sem papel");
    if (actor.org_id && actor.org_id !== tenant.org_id) {
      throw new RuntimeError("TENANT_SCOPE_VIOLATION", "ator fora do tenant da sessao");
    }
    // Tentativa de injetar tenant pelo corpo do pedido e violacao, nao correcao.
    if (req.input?.org_id || req.input?.workspace_id) {
      throw new RuntimeError("TENANT_SCOPE_VIOLATION", "tenant nao pode vir do input do usuario");
    }
    if (!(await registry.workspaceBelongsToOrg(tenant.workspace_id, tenant.org_id))) {
      throw new RuntimeError("TENANT_SCOPE_VIOLATION", "workspace nao pertence a organizacao");
    }

    // --- Agente ------------------------------------------------------------
    const agent = await registry.getAgent(req.agent_id);
    if (!agent) throw new RuntimeError("AGENT_NOT_ACTIVE", `agente desconhecido: ${req.agent_id}`);
    if (agent.status !== "ACTIVE" && !(agent.status === "CANDIDATE" && req.internal === true)) {
      throw new RuntimeError("AGENT_NOT_ACTIVE",
        `agente ${agent.agent_id} esta ${agent.status}; CANDIDATE so roda em modo interno`);
    }
    // Agente ainda CANDIDATE nunca opera acima do proprio baseline.
    const teto = agent.status === "ACTIVE" ? (agent.max_autonomy ?? agent.baseline_autonomy) : agent.baseline_autonomy;
    const autonomy_ceiling =
      req.requested_autonomy && autonomyRank(req.requested_autonomy) < autonomyRank(teto)
        ? req.requested_autonomy
        : teto;

    // --- Registro do run ---------------------------------------------------
    const run_id = ids.newId();
    await runs.start({
      id: run_id, org_id: tenant.org_id, workspace_id: tenant.workspace_id, trace_id,
      agent_id: agent.agent_id, agent_version: agent.version,
      task_class: agent.model_profile?.task_class ?? null,
      status: "RUNNING", started_at: new Date(started_at).toISOString(),
    });

    try {
      const model = await modelGateway.complete({
        trace_id, tenant,
        task_class: agent.model_profile?.task_class ?? "reasoning",
        messages: buildMessages(agent, req.input),
        schema_ref: req.schema_ref ?? null,
        material: req.material === true,
        allow_fallback_on_material: req.allow_fallback_on_material === true,
        max_cost_cents: agent.model_profile?.max_cost_cents_per_run,
      });

      const response = {
        trace_id,
        respondability: "EXECUTABLE",
        message: model.parsed?.message ?? model.content,
        next_step: model.parsed?.next_step ?? "Revise o resultado.",
        autonomy_mode: modeFor(autonomy_ceiling),
        reason_codes: [],
        evidence_ids: model.parsed?.evidence_ids ?? [],
        receipt_ids: [],
      };
      assertValid("olga://io/final-response", response);

      await runs.finish(run_id, {
        status: "SUCCEEDED",
        respondability: "EXECUTABLE",
        autonomy_used: autonomy_ceiling,
        model: `${model.provider}:${model.model}`,
        input_tokens: model.input_tokens, output_tokens: model.output_tokens,
        cost_cents: model.cost_cents, latency_ms: model.latency_ms,
        finished_at: new Date(now()).toISOString(),
      });

      tracer?.event?.({ trace_id, event: "agent.completed", agent_id: agent.agent_id,
                        cost_cents: model.cost_cents, fallback_used: model.fallback_used });

      return { run_id, trace_id, response, model: stripContent(model), autonomy_ceiling };
    } catch (e) {
      const reason = e.reason_code ?? "PROVIDER_UNAVAILABLE";
      // O run nao some porque falhou. O registro fica com o motivo.
      await runs.finish(run_id, {
        status: reason === "SPEND_LIMIT_EXCEEDED" ? "BLOCKED" : "FAILED",
        respondability: reason === "SPEND_LIMIT_EXCEEDED" ? "POLICY_BLOCKED" : "TEMPORARILY_UNAVAILABLE",
        reason_codes: [reason],
        latency_ms: now() - started_at,
        finished_at: new Date(now()).toISOString(),
      });
      tracer?.event?.({ trace_id, event: "agent.failed", agent_id: req.agent_id, reason_code: reason });
      throw e instanceof ModelError || e instanceof RuntimeError ? e : new RuntimeError(reason, e.message);
    }
  }

  return { run };
}

function buildMessages(agent, input) {
  // O prompt e projecao fina do contrato, nao a fonte de verdade (MKT-09 §1).
  return [
    { role: "system", content: `Missao: ${agent.mission}\nCapabilities: ${(agent.capabilities ?? []).join(", ")}` },
    { role: "user", content: input?.text ?? "" },
  ];
}

const modeFor = (a) => ({ A0: "SUGGEST", A1: "SUGGEST", A2: "DRAFT", A3: "GOVERNED_EXECUTE", A4: "AUTOPILOT" }[a] ?? "SUGGEST");
const stripContent = (m) => ({ ...m, content: undefined, parsed: undefined });
