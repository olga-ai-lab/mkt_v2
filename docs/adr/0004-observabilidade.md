# ADR-0004 — Observabilidade: Langfuse para LLM, OpenTelemetry para o resto

- **Status:** ACEITA
- **Data:** 24/08/2026
- **Fecha:** achado G9 do MKT-17 (excesso de decisões em aberto)

## Contexto

MKT-09B §15 deixa `observability backend` OPEN. O contrato de trace do MKT-SPEC §13 exige agent/version, model, versões de contrato, reason codes, evidence, custo e latência.

## Decisão

Langfuse para as chamadas de modelo, OTel para o restante. Nenhum backend próprio.

## Alternativas consideradas

Construir o console de observabilidade antes de ter o que observar seria inverter a ordem.

## Consequências e ponto de revisão

Revisar no piloto pago. O contrato de trace é nosso; o backend é substituível.
