# ADR-0007 — Vetores: pgvector no mesmo Postgres

- **Status:** ACEITA
- **Data:** 24/08/2026
- **Fecha:** achado G9 do MKT-17 (excesso de decisões em aberto)

## Contexto

MKT-08 §2 é explícito: dado derivado — search e vector — pode ser reconstruído e não é fonte de verdade.

## Decisão

pgvector no mesmo banco. Nenhum banco vetorial dedicado.

## Alternativas consideradas

Pinecone, Qdrant e afins adicionam sincronização e custo para um índice que é reconstruível.

## Consequências e ponto de revisão

Revisar se o volume de retrieval degradar o OLTP.
