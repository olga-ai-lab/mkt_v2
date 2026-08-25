# ADR-0006 — Redis fora do MVP

- **Status:** ACEITA
- **Data:** 24/08/2026
- **Fecha:** achado G9 do MKT-17 (excesso de decisões em aberto)

## Contexto

MKT-09B §15 marca Redis como CANDIDATE para cache, lock e rate limit.

## Decisão

Não usar Redis nas Fases 0 a 2. Lock com advisory lock do Postgres; dedup com constraint de unicidade.

## Alternativas consideradas

Redis resolveria, mas adiciona um serviço para operar sem pressão real de rate limit.

## Consequências e ponto de revisão

Revisar quando o provider impuser rate limit que a constraint não absorva.
