# ADR-0005 — Segredos: Supabase Vault, com contrato de referência

- **Status:** ACEITA
- **Data:** 24/08/2026
- **Fecha:** achado G9 do MKT-17 (excesso de decisões em aberto)

## Contexto

MKT-09B §15 deixa `secret manager` OPEN, mas §2 é firme: 'Secrets outside context — tokens em vault, nunca prompt, evidence ou trace'.

## Decisão

`mkt.connections.secret_ref` guarda a referência; o adapter resolve a credencial. Supabase Vault no MVP.

## Alternativas consideradas

Vault gerenciado dedicado é melhor em enterprise, mas o que importa agora é o contrato, não o cofre.

## Consequências e ponto de revisão

Revisar quando houver exigência enterprise. A troca mexe no adapter, não no domínio.
