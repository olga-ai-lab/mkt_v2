/**
 * Outbox → Inngest (T5).
 *
 * A tabela `mkt.outbox` recebe a intencao de evento no MESMO commit da mudanca
 * de estado do dominio. Isso resolve o problema de escrever no banco e publicar
 * no barramento em dois lugares que podem divergir. O que faltava era o
 * consumidor: alguem que drene a tabela e entregue ao motor durável.
 *
 * Sao duas pecas, e a separacao entre elas e o ponto:
 *
 *   createOutboxRelay    — drena o outbox e entrega ao barramento. AT-LEAST-ONCE.
 *   createDedupedHandler — guarda de consumo, apoiada em mkt.processed_events.
 *
 * ── Por que at-least-once, e nao exactly-once ───────────────────────────────
 *
 * Entre `bus.send()` e `markPublished()` existe uma janela. Se o processo cair
 * ali, a linha continua sem published_at e sera entregue de novo. Nao ha como
 * fechar essa janela sem transacao distribuida entre Postgres e o barramento —
 * e nao vamos ter uma.
 *
 * Entao a entrega duplicada e assumida, e a defesa fica onde ela ja existe:
 * a idempotencia do efeito externo mora no Capability Gateway, uma camada
 * abaixo (mesma propriedade que o Gate G1 cobra do replay do workflow).
 * O ledger processed_events NAO e o que impede post duplicado; ele evita
 * trabalho repetido e escrita repetida no dominio.
 *
 * ── Por que marcar DEPOIS, e nao reservar ANTES ─────────────────────────────
 *
 * A alternativa seria reservar a chave em processed_events antes de rodar o
 * handler (insert ... on conflict do nothing) e desistir se outro ja reservou.
 * Isso perde evento: se o processo cair entre a reserva e o efeito, a
 * reentrega do Inngest encontra a chave reservada e pula — o evento some em
 * silencio, que e a pior falha possivel num outbox.
 *
 * Marcar depois do sucesso troca "perder evento" por "talvez repetir trabalho".
 * Para este sistema a escolha nao e dificil: repetir trabalho e visivel,
 * deduplicado pelo gateway e barato; perder publicacao e invisivel e caro.
 */

/** Chave de deduplicacao de um evento entregue pelo relay. */
export function outboxEventKey(data) {
  if (data?.outbox_id == null) {
    throw new Error("evento sem outbox_id: nao da para deduplicar o que nao tem identidade");
  }
  return `outbox:${data.outbox_id}`;
}

/**
 * Drena o outbox para o barramento.
 *
 * @param {object}  db          porta: claimOutboxBatch, markOutboxPublished
 * @param {object}  bus         porta: send({ name, data })
 * @param {number}  batchSize   linhas por passada
 * @param {number}  maxAttempts depois disto a linha para de ser tentada e vira "stuck"
 */
export function createOutboxRelay({ db, bus, tracer, batchSize = 100, maxAttempts = 5 }) {
  return async function drain() {
    // O claim ja incrementa attempts. Uma linha que derruba o processo antes do
    // send volta com attempts maior, entao um envenenado nao segura a fila para
    // sempre: passa de maxAttempts e sai do caminho dos outros.
    const rows = await db.claimOutboxBatch(batchSize, maxAttempts);
    const sent = [], failed = [];

    for (const row of rows) {
      try {
        await bus.send({
          name: row.event_type,
          data: {
            ...row.payload,
            // Identidade do evento no barramento. E o que o consumidor usa
            // para deduplicar; sem isto o handler nao tem como se defender.
            outbox_id: String(row.id),
            org_id: row.org_id,
            workspace_id: row.workspace_id ?? row.payload?.workspace_id ?? null,
            trace_id: row.trace_id ?? row.payload?.trace_id ?? null,
          },
        });
        await db.markOutboxPublished(row.id);
        sent.push(row.id);
      } catch (e) {
        // Nao marca published_at: a linha volta na proxima passada, ate maxAttempts.
        failed.push({ id: row.id, error: String(e?.message ?? e), attempts: row.attempts });
        tracer?.event?.({
          trace_id: row.trace_id, event: "outbox.send_failed",
          outbox_id: String(row.id), attempts: row.attempts, error: String(e?.message ?? e),
        });
      }
    }

    tracer?.event?.({ event: "outbox.drained", claimed: rows.length, sent: sent.length, failed: failed.length });
    return { claimed: rows.length, sent, failed };
  };
}

/**
 * Envolve um handler de workflow com a guarda de consumo.
 *
 * O check e o mark entram como checkpoints do `step`, para que o replay do
 * motor durável nao os reexecute a toa.
 *
 * @param {string} consumer nome do consumidor no ledger (uma fila = um nome)
 */
export function createDedupedHandler({ db, consumer, handler, tracer, keyOf = outboxEventKey }) {
  return async function handle(data, step) {
    const event_key = keyOf(data);

    const seen = await step.run("dedup-check", async () => db.wasProcessed(consumer, event_key));
    if (seen) {
      tracer?.event?.({ trace_id: data?.trace_id, event: "consumer.deduplicated", consumer, event_key });
      return { status: "DEDUPLICATED", event_key, deduplicated: true };
    }

    const out = await handler(data, step);

    // So depois do sucesso. Se o handler lancar, nada e marcado e a reentrega
    // do motor durável encontra o evento ainda por processar — que e o
    // comportamento correto de um outbox.
    await step.run("dedup-mark", async () => db.markProcessed(consumer, event_key));

    return { ...out, event_key, deduplicated: false };
  };
}
