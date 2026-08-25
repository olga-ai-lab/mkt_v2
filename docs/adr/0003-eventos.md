# ADR-0003 — Eventos: outbox em Postgres, sem broker

- **Status:** ACEITA
- **Data:** 24/08/2026
- **Fecha:** achado G9 do MKT-17 (excesso de decisões em aberto)

## Contexto

MKT-09B §15 deixa `event broker` OPEN. MKT-08 §12 já exige outbox transacional.

## Decisão

Tabela `mkt.outbox` gravada no mesmo commit da mudança de estado. Consumidores idempotentes via `mkt.processed_events`.

## Alternativas consideradas

Kafka, SQS ou Redis Streams adicionam um sistema para operar antes de haver volume que justifique.

## Consequências e ponto de revisão

Revisar quando os scaling signals do MKT-09B §11.1 aparecerem: lag de outbox quebrando freshness.
