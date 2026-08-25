# ADR-0011 — Schema `mkt` isolado, não `public`

- **Status:** ACEITA
- **Data:** 24/08/2026
- **Fecha:** achado G9 do MKT-17 (excesso de decisões em aberto)

## Contexto

O banco escolhido para o Marketing OS é o projeto da org Olga, que já hospeda a base de produção do Chat BI/SUSEP com 176 tabelas em `public`, incluindo 23 milhões de linhas em `SES_Balanco`.

## Decisão

Todo o Marketing OS vive no schema `mkt`. Nada é criado, alterado ou lido em `public`. Funções, enums e tabelas usam o mesmo namespace.

## Alternativas consideradas

Projeto Supabase separado seria melhor em blast radius e foi a primeira escolha; a conexão disponível não permite criar projeto naquela organização.

## Consequências e ponto de revisão

A reversão é uma operação só: `drop schema mkt cascade`. Se um projeto dedicado for criado depois, as migrations rodam nele sem alteração — o schema é o único acoplamento.
