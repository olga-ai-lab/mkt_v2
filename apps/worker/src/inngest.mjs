/**
 * Registro das funções Inngest (ADR-0001). O workflow em si é agnóstico:
 * aqui só ligamos o `step` do Inngest ao contrato `{ run(name, fn) }`.
 */
import { createPublishWorkflow } from "./publish-workflow.mjs";

export function registerFunctions({ inngest, gateway, db, tracer }) {
  const publish = createPublishWorkflow({ gateway, db, tracer });

  return [
    inngest.createFunction(
      {
        id: "publish-content",
        retries: 4,
        // Uma publicação por versão/canal/conexão em voo. O gateway ainda
        // deduplica, mas concorrência 1 evita trabalho jogado fora.
        concurrency: { key: "event.data.content_version_id + event.data.channel", limit: 1 },
        onFailure: async ({ event, error }) => {
          await db.updateWorkflowRun(event.data.trace_id, {
            current_state: "DEAD_LETTERED", dead_lettered: true,
            last_reason_code: error?.reason_code ?? "PROVIDER_UNAVAILABLE",
          });
        },
      },
      { event: "olga/content.publish.requested" },
      async ({ event, step }) => publish(event.data, step),
    ),
  ];
}
