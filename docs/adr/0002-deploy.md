# ADR-0002 — Deploy: Vercel para a web, Inngest Cloud para o worker

- **Status:** ACEITA
- **Data:** 24/08/2026
- **Fecha:** achado G9 do MKT-17 (excesso de decisões em aberto)

## Contexto

MKT-09B §15 deixa `deployment` OPEN, e §2 já orienta 'Simple first: sem Kubernetes como pré-condição'.

## Decisão

Vercel para `apps/web`, Inngest Cloud para `apps/worker`. Nenhum Kubernetes.

## Alternativas consideradas

Containers em ECS/Fly resolveriam, mas adicionam operação que o time não tem para dar.

## Consequências e ponto de revisão

Revisar quando o media-worker (geração de imagem) exigir GPU ou execução longa — provavelmente Fase 3.
