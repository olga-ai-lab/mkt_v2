# Olga Marketing OS

Implementação da **Fase 0 (Fundação)** e do núcleo da **Fase 1 (Walking skeleton)**
do plano MKT-17.

> O LLM interpreta; os contratos decidem; o código calcula; as ferramentas
> executam; a evidência sustenta.

Este repositório existe para transformar esse princípio em algo que quebra
quando alguém o contraria. Um schema JSON validado em CI é mais normativo que
um PDF aprovado.

---

## O que já está de pé

| Peça | O que faz | Prova |
|---|---|---|
| `packages/contracts` | JSON Schema dos 10 objetos de I/O, dos 3 registries e dos enums fechados. Tipos TS gerados | 15 testes |
| `packages/policy` | Policy engine determinístico: invariantes de código + regras como dado, default deny | 19 testes |
| `packages/gateway` | Capability Gateway com os 8 passos do MKT-09B §10 | 19 testes |
| `packages/db` | 6 migrations, 25 tabelas, RLS forçada, state machine no banco | 18 testes |
| `apps/worker` | Workflow durável de publicação, replay-safe | 5 testes |
| `apps/web` | Tokens do MKT-06A e microcopy de todo reason code | 4 testes |
| `docs/adr` | 11 ADRs fechando o que o MKT-09B deixava OPEN | — |
| `docs/AGT-BASE.md` | O contrato comum que os 13 pacotes repetiam | — |

**80 testes.** `npm run gate:g0` verifica os nove critérios do Gate G0 executando
cada um deles.

## As três decisões que este código materializa

**1. A0–A4 existe.** O MKT-17 apontou que os níveis de autonomia — o diferencial
de confiança declarado no MKT-01 — apareciam em cinco documentos e não estavam
definidos em nenhum. Agora estão em `packages/contracts/enums/autonomy.json`,
com semântica por nível e exigências de plataforma. Um teste garante que só A3 e
A4 produzem efeito externo e que ambos exigem idempotência e receipt.

**2. Policy é dado, não prompt nem código.** Duas camadas: invariantes
hard-coded que nada configurável afrouxa, e `mkt.rule_policies` avaliadas por
prioridade. **Policy só restringe.** Nenhuma linha de banco concede mais
autonomia que o teto de risco. Capability de escrita sem policy ACTIVE é negada.

**3. Replay não duplica.** A idempotência não está no workflow; está no
Capability Gateway e numa constraint de unicidade. O workflow pode ser
reexecutado do zero quantas vezes for — o teste faz isso dez vezes e verifica
que o provider foi chamado uma única vez.

## Rodar

```bash
npm install
npm run contracts:generate

createdb olga_test
export TEST_DATABASE_URL=postgres://postgres@localhost:5432/olga_test
npm run db:migrate:local

npm test          # todos os testes
npm run gate:g0   # verificação do Gate G0
```

## Estrutura

```
packages/contracts   schemas, enums, validadores, tipos gerados
packages/policy      engine determinístico de autonomia e policy
packages/gateway     única porta de efeito colateral
packages/db          migrations e testes de isolamento
apps/web             Next.js — tokens e microcopy
apps/worker          Inngest — workflow durável de publicação
docs/adr             decisões técnicas com ponto de revisão
scripts/gate-g0.mjs  verificação executável do gate
```

## Banco

Todo o Marketing OS vive no schema **`mkt`**. Nada em `public`. A migration
`0001` cria o schema, as funções de acesso e o helper `mkt.enable_org_rls()`
por onde passa toda tabela tenant-owned.

Reverter é uma operação: `drop schema mkt cascade`.

Ver `docs/adr/0011-schema-mkt.md` para o porquê.

## O que falta para fechar a Fase 1

1. **Submeter o app na Meta** — caminho crítico, duas a seis semanas (ADR-0008).
   Até lá, o adapter falso implementa o mesmo contrato e o gateway não distingue.
2. Adapter real do Meta Graph em `packages/gateway/src/adapters/`.
3. Rota de agente e Model Gateway com custo por run no trace.
4. Tela de aprovação com decisão vinculada à versão.
5. Ligar `mkt.outbox` ao Inngest.

## Rastreabilidade

Toda decisão material aponta para a fonte: MKT-01 a MKT-09B nos comentários das
migrations e dos schemas, MKT-17 nas ADRs. Nenhuma regra crítica vive apenas em
prompt — que é o que a Definition of Done do MKT-SPEC-STANDARD-01 exige.
