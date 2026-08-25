/**
 * Workflow durável de publicação (J11).
 *
 * Escrito como uma função pura sobre um `step` injetado. Em produção o `step`
 * é o do Inngest (ADR-0001); no teste é um step falso que sabe crashar entre
 * etapas e reexecutar o workflow desde o início — que é exatamente o que um
 * motor durável faz num replay.
 *
 * A propriedade que o Gate G1 exige: **replay não duplica efeito.** Ela não
 * vem do workflow, vem do Capability Gateway. O workflow pode ser reexecutado
 * quantas vezes for; a idempotência mora uma camada abaixo.
 */
import { buildIdempotencyKey } from "@olga/gateway";

export const PUBLISH_STATES = ["RECEIVED", "GATED", "PUBLISHING", "PUBLISHED", "FAILED", "DEAD_LETTERED"];

export function createPublishWorkflow({ gateway, db, tracer }) {
  /**
   * @param {object} event { org_id, workspace_id, content_version_id, channel, connection_id, channel_variant_id, actor, approval_id, trace_id }
   * @param {object} step  { run(name, fn) } — checkpoint durável
   */
  return async function publish(event, step) {
    const trace_id = event.trace_id;

    // 1. Checkpoint: registrar o run. Reexecução encontra o mesmo registro.
    await step.run("registrar-run", async () => {
      await db.upsertWorkflowRun({
        org_id: event.org_id, workspace_id: event.workspace_id,
        workflow_id: "publish", trace_id, current_state: "RECEIVED",
      });
    });

    // 2. Checkpoint: reunir os fatos que a policy vai avaliar.
    const facts = await step.run("coletar-fatos", async () => db.collectPublishFacts(event));

    // 3. A chave é derivada do template do registry, não inventada aqui.
    const cap = await db.getCapability("publishing.publish", 1);
    const idempotency_key = buildIdempotencyKey(cap.idempotency.key_template, {
      workspace_id: event.workspace_id,
      content_version_id: event.content_version_id,
      channel: event.channel,
      connection_id: event.connection_id,
    });

    // 4. Efeito. O gateway aplica policy, dedup, retry, normalização e receipt.
    const result = await step.run("executar-publicacao", async () =>
      gateway.execute({
        trace_id,
        tenant: { org_id: event.org_id, workspace_id: event.workspace_id },
        capability_id: "publishing.publish",
        capability_version: 1,
        mode: "write",
        args: {
          channel: event.channel,
          content_version_id: event.content_version_id,
          connection_id: event.connection_id,
          channel_variant_id: event.channel_variant_id,
        },
        idempotency_key,
        requested_autonomy: event.requested_autonomy ?? "A3",
        approval_id: event.approval_id ?? null,
      }, { facts, actor: event.actor }),
    );

    const { execution, respondability, receipt } = result;

    // 5. Checkpoint: refletir o efeito no domínio, no mesmo commit do outbox.
    await step.run("persistir-resultado", async () => {
      if (execution.status === "SUCCEEDED" || execution.status === "DEDUPLICATED") {
        await db.markPublished({
          ...event, external_id: execution.external_id,
          receipt_id: receipt?.receipt_id ?? null, trace_id,
          deduplicated: execution.status === "DEDUPLICATED",
        });
        await db.updateWorkflowRun(trace_id, { current_state: "PUBLISHED" });
        return;
      }

      if (execution.status === "BLOCKED") {
        // Rejeição de policy não é falha técnica. Não entra em retry.
        await db.markBlocked({ ...event, trace_id, reason_code: execution.error.reason_code,
                               respondability: respondability.state });
        await db.updateWorkflowRun(trace_id, { current_state: "FAILED",
                                               last_reason_code: execution.error.reason_code });
        return;
      }

      const retryable = execution.error?.retryable === true;
      await db.markFailed({ ...event, trace_id, reason_code: execution.error?.reason_code,
                            error_class: execution.error?.class });
      await db.updateWorkflowRun(trace_id, {
        current_state: retryable ? "FAILED" : "DEAD_LETTERED",
        dead_lettered: !retryable,
        last_reason_code: execution.error?.reason_code,
      });
    });

    tracer?.event?.({ trace_id, event: "workflow.publish.finished", status: execution.status });
    return { status: execution.status, external_id: execution.external_id,
             reason_codes: respondability.reason_codes, receipt_id: receipt?.receipt_id ?? null };
  };
}
