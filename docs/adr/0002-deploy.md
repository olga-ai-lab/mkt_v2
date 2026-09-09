# ADR-0002 — Deploy: Vercel para a web, Inngest Cloud para o worker

- **Status:** SUPERSEDIDA pela ADR-0012 em 08/09/2026 — a web foi para o
  Railway. A parte sobre o Inngest Cloud **continua valendo**: ele nunca foi
  alternativa ao Railway, e segue sendo o motor durável (ADR-0001).
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

## O que aconteceu

O ponto de revisão foi antecipado. A Olga decidiu Railway em 08/09/2026, antes
da Fase 3 e contra a recomendação da própria ADR-0012 — que sugeria esperar. A
decisão é dela; o registro de que a análise apontava para o outro lado fica
lá, e não aqui.

O que esta ADR decidiu sobre o **Inngest** não foi revogado. Railway substituiu
a Vercel; o motor durável continua sendo o Inngest Cloud, servido pelo endpoint
em `apps/web/app/api/inngest/route.ts`. Mudou o host que ele chama, não quem
executa.
