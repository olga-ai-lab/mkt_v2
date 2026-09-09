/**
 * O agendador dos slots recorrentes (C3).
 *
 * Roda no relogio, no mesmo formato do relay do outbox — e pelo mesmo motivo:
 * se dependesse de um evento para acordar, dependeria justamente do caminho
 * que pode ter falhado.
 *
 * ── O que ele NAO faz ─────────────────────────────────────────────────────
 *
 * Nao escreve em `publications` nem no outbox. Ele chama `publishing.schedule`
 * PELO Capability Gateway, como qualquer outro efeito. Recorrencia nao e
 * exceção ao invariante — e justamente onde a exceção seria mais tentadora,
 * porque "e so um insert" e o que se pensa antes de duplicar policy.
 *
 * ── Os tres desfechos, e por que nenhum deles e erro ──────────────────────
 *
 *   SCHEDULED   havia conteudo aprovado, e ele foi agendado
 *   NO_CONTENT  o slot venceu e nao havia nada aprovado para aquele canal
 *   BLOCKED     havia conteudo, e a policy recusou — com reason code
 *
 * NO_CONTENT e o estado esperado de um calendario que anda mais rapido que a
 * producao. Trata-lo como falha encheria o alerta de ruido ate ninguem mais
 * olhar. E BLOCKED nunca e pulado em silencio: o motivo fica na linha do slot,
 * porque um slot que para de publicar sem dizer por que e a pior falha
 * possivel de um agendador.
 *
 * O slot avanca nos tres casos. Um slot que nao avancasse por falta de
 * conteudo tentaria de novo a cada passada, e no dia em que houvesse conteudo
 * publicaria a ocorrencia atrasada como se fosse a de hoje.
 */
import { createHash } from "node:crypto";
import { proximaOcorrencia } from "@olga/runtime/recurrence";

/**
 * A chave de idempotencia de uma ocorrencia.
 *
 * Derivada do SLOT e do INSTANTE que venceu — nao do conteudo escolhido. A
 * diferenca importa no caso que este agendador pode sofrer de verdade:
 *
 *   1. o gateway agenda o conteudo A
 *   2. o processo morre antes de `advance`
 *   3. a passada seguinte reclama o mesmo slot, e agora A ja nao esta
 *      APPROVED — entao ela escolhe B
 *
 * Com a chave presa ao conteudo, B seria agendado e a ocorrencia produziria
 * dois posts. Presa a ocorrencia, o gateway devolve DEDUPLICATED e o slot
 * apenas avanca. Uma ocorrencia, um post — que e o que um slot no calendario
 * promete.
 *
 * `publishing.schedule` nao tem `key_template` no registry (ela e interna, sem
 * efeito externo para deduplicar la fora), entao a chave nasce aqui. O
 * contrato `capability-request` a exige de qualquer forma, e exige com razao.
 */
function chaveDaOcorrencia(slot) {
  const material = `${slot.id}|${new Date(slot.next_run_at).toISOString()}`;
  return `slot_${createHash("sha256").update(material).digest("hex").slice(0, 40)}`;
}

/** Tudo que este runner chama em `db`. Conferido na montagem. */
export const SCHEDULE_DB_SURFACE = ["claimDue", "advance", "nextApproved", "creatorRole", "collectPublishFacts"];

export function createScheduleRunner({ gateway, db, tracer, agora = () => new Date(), ids }) {
  return async function rodar() {
    const instante = agora();
    const vencidos = await db.claimDue(instante);
    const resultado = { avaliados: vencidos.length, agendados: 0, sem_conteudo: 0, bloqueados: 0 };

    for (const slot of vencidos) {
      // Um trace por ocorrencia: cada uma e um pedido proprio e precisa poder
      // ser auditada sozinha em /traces.
      const trace_id = ids?.newTraceId?.() ?? `tr_slot_${slot.id}`;
      const proxima = proximaOcorrencia(slot, instante);
      const emitir = (e, extra) => tracer?.event?.({ trace_id, event: e, slot_id: slot.id, ...extra });

      // Sob que autoridade esta ocorrencia roda: a de quem criou o slot, com o
      // papel que essa pessoa tem AGORA. Nao existe ator "sistema" aqui — o
      // gateway confere o papel contra `permissions` no registry, e inventar um
      // papel para o agendador seria criar um caminho que ignora aquela coluna.
      const papel = await db.creatorRole(slot.org_id, slot.created_by);
      if (!papel) {
        await db.advance(slot.id, {
          next_run_at: proxima, outcome: "BLOCKED",
          reason_code: "ACTOR_ROLE_FORBIDDEN", agora: instante,
        });
        resultado.bloqueados += 1;
        emitir("slot.sem_ator", { created_by: slot.created_by });
        continue;
      }

      const alvo = await db.nextApproved(slot.org_id, slot.workspace_id, slot.channel);

      if (!alvo) {
        await db.advance(slot.id, { next_run_at: proxima, outcome: "NO_CONTENT", agora: instante });
        resultado.sem_conteudo += 1;
        emitir("slot.sem_conteudo", {});
        continue;
      }

      const evento = {
        org_id: slot.org_id, workspace_id: slot.workspace_id,
        content_version_id: alvo.content_version_id,
        channel_variant_id: alvo.channel_variant_id,
        connection_id: slot.connection_id,
        channel: slot.channel,
      };

      // Os fatos vem do banco, como na publicacao: o policy engine nunca le
      // texto livre nem consulta banco por conta propria.
      const facts = await db.collectPublishFacts(evento);

      const { execution, respondability } = await gateway.execute({
        trace_id,
        tenant: { org_id: slot.org_id, workspace_id: slot.workspace_id },
        capability_id: "publishing.schedule",
        capability_version: 1,
        mode: "write",
        args: {
          content_version_id: alvo.content_version_id,
          channel: slot.channel,
          connection_id: slot.connection_id,
          channel_variant_id: alvo.channel_variant_id,
          scheduled_at: slot.next_run_at,
        },
        // A2 e o teto que POL_SCHEDULE_DEFAULT concede para agendar. Pedir A3
        // aqui so produziria AUTONOMY_EXCEEDED em toda ocorrencia.
        requested_autonomy: "A2",
        idempotency_key: chaveDaOcorrencia(slot),
      }, { facts, actor: { id: slot.created_by, role: papel, org_id: slot.org_id } });

      if (execution.status === "SUCCEEDED" || execution.status === "DEDUPLICATED") {
        await db.advance(slot.id, { next_run_at: proxima, outcome: "SCHEDULED", agora: instante });
        resultado.agendados += 1;
        emitir("slot.agendado", { content_version_id: alvo.content_version_id });
        continue;
      }

      // Recusa da policy nao e falha tecnica: o motivo fica na linha do slot,
      // e a ocorrencia seguinte tenta de novo com o que houver aprovado entao.
      //
      // `reason_codes[0]` e a CAUSA, e nao um invariante que baixou o teto de
      // passagem — o policy engine garante essa ordem, e ha teste para ela.
      // Antes dessa garantia, um slot bloqueado por canal desconectado
      // gravava WORKSPACE_FIRST_PUBLISH aqui.
      const reason_code = execution.error?.reason_code ?? respondability?.reason_codes?.[0] ?? null;
      await db.advance(slot.id, {
        next_run_at: proxima, outcome: "BLOCKED", reason_code, agora: instante,
      });
      resultado.bloqueados += 1;
      emitir("slot.bloqueado", { reason_code });
    }

    return resultado;
  };
}
