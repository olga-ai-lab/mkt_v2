/**
 * Registro das funcoes Inngest (ADR-0001). O workflow em si e agnostico:
 * aqui so ligamos o `step` do Inngest ao contrato `{ run(name, fn) }`.
 *
 * API v4: o gatilho vai DENTRO do primeiro argumento, em `triggers`. A forma
 * de tres argumentos — config, gatilho, handler — e da v3 e falha em tempo de
 * montagem. Este arquivo esteve escrito na forma antiga por um bom tempo sem
 * ninguem notar, porque nenhum cliente Inngest real chegava a ser construido.
 * Hoje packages/db/test/composition.test.mjs constroi um.
 */
import { createPublishWorkflow } from "./publish-workflow.mjs";
import { createOutboxRelay, createDedupedHandler } from "./outbox-relay.mjs";
import { createScheduleRunner } from "./schedule-runner.mjs";

export const PUBLISH_CONSUMER = "publish-content";

export function registerFunctions({ inngest, gateway, db, tracer,
                                   outboxCron = "*/1 * * * *",
                                   scheduleCron = "*/5 * * * *" }) {
  const publish = createPublishWorkflow({ gateway, db, tracer });

  // O handler registrado nao e o workflow cru: e o workflow atras da guarda de
  // consumo. O outbox entrega pelo menos uma vez, entao a guarda nao e um luxo.
  const publishDeduped = createDedupedHandler({
    db, tracer, consumer: PUBLISH_CONSUMER, handler: publish,
  });

  return [
    inngest.createFunction(
      {
        id: "publish-content",
        retries: 4,
        triggers: [{ event: "olga/content.publish.requested" }],
        // Uma publicacao por versao/canal/conexao em voo. O gateway ainda
        // deduplica, mas concorrencia 1 evita trabalho jogado fora.
        concurrency: { key: "event.data.content_version_id + event.data.channel", limit: 1 },
        onFailure: async ({ event, error }) => {
          // Em onFailure o payload original vem aninhado em event.data.event.
          const original = event?.data?.event?.data ?? event?.data ?? {};
          await db.updateWorkflowRun(original.trace_id, {
            current_state: "DEAD_LETTERED", dead_lettered: true,
            last_reason_code: error?.reason_code ?? "PROVIDER_UNAVAILABLE",
          });
        },
      },
      async ({ event, step }) => publishDeduped(event.data, step),
    ),

    // Relay do outbox. Roda no relogio em vez de reagir a evento: se dependesse
    // de um evento para drenar, dependeria justamente do caminho que pode ter
    // falhado. Cron nao tem esse acoplamento.
    inngest.createFunction(
      {
        id: "outbox-relay",
        triggers: [{ cron: outboxCron }],
        // Um relay por vez. Nao por correcao (o claim usa skip locked e aguenta
        // concorrencia), mas porque duas passadas simultaneas so criam entrega
        // duplicada sem drenar mais rapido.
        concurrency: { limit: 1 },
      },
      async ({ step }) => {
        const relay = createOutboxRelay({
          db, tracer,
          bus: { send: async (e) => inngest.send(e) },
        });
        return step.run("drenar-outbox", relay);
      },
    ),

    // Slots recorrentes (C3). No relogio pelo mesmo motivo do relay: depender
    // de evento para acordar seria depender do caminho que pode ter falhado.
    //
    // A cada cinco minutos, e nao a cada minuto: a granularidade do slot e a
    // hora, entao passar de minuto em minuto so multiplicaria consultas para
    // achar a mesma coisa.
    inngest.createFunction(
      {
        id: "publication-schedules",
        triggers: [{ cron: scheduleCron }],
        // Um agendador por vez. Aqui, ao contrario do relay, concorrencia nao
        // seria so trabalho perdido: duas passadas no mesmo slot agendariam
        // dois posts para o mesmo horario. O `skip locked` do claim ja
        // defende, e este limite e a segunda tranca.
        concurrency: { limit: 1 },
      },
      async ({ step }) => {
        const runner = createScheduleRunner({
          gateway, db, tracer,
          ids: { newTraceId: () => `tr_${crypto.randomUUID()}` },
        });
        return step.run("materializar-slots", runner);
      },
    ),
  ];
}
