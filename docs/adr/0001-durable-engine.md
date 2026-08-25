# ADR-0001 — Motor de workflow durável: Inngest

- **Status:** ACEITA
- **Data:** 24/08/2026
- **Fecha:** achado G9 do MKT-17 (excesso de decisões em aberto)

## Contexto

MKT-09B §15 deixa `durable engine` como OPEN, com Inngest candidate e Temporal alternativa. Para 1–2 devs, cada decisão aberta é uma sessão de pesquisa que não vira produto.

## Decisão

Usar **Inngest**. Zero infraestrutura para operar, waits e retries nativos, integração direta com Next.js.

## Alternativas consideradas

Temporal exige cluster ou Temporal Cloud e um modelo mental maior. Fila própria em Postgres foi descartada: reconstruiríamos retry, wait e replay à mão.

## Consequências e ponto de revisão

Revisar no gate da Fase 4, quando existirem workflows de campanha de longa duração. O custo de troca é contido porque o efeito colateral está atrás do Capability Gateway, não dentro do workflow.
