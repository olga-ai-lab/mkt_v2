# Olga Marketing OS

Implementação da **Fase 0 (Fundação)** e da **Fase 1 (Walking skeleton)** do
plano MKT-17. O esqueleto anda de ponta a ponta: pedir aprovação → aprovar →
agendar → outbox → workflow → gateway → adapter → publicado, provado contra
Postgres em `packages/db/test/pipeline.test.mjs`.

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
| `packages/db` | 8 migrations, 28 tabelas, RLS forçada, state machine no banco | 35 testes |
| `packages/runtime` | Model Gateway (rota por task class, orçamento antes do gasto, fallback explícito) e Agent Runtime (tenant fora do LLM, custo por run) | 29 testes |
| `apps/worker` | Workflow durável de publicação, replay-safe | 5 testes |
| `apps/web` | Tokens do MKT-06A e microcopy de todo reason code | 4 testes |
| `docs/adr` | 11 ADRs fechando o que o MKT-09B deixava OPEN | — |
| `docs/AGT-BASE.md` | O contrato comum que os 13 pacotes repetiam | — |

**126 testes.** `npm run gate:g0` verifica os dez critérios do Gate G0 executando
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

**3. Fallback de modelo nunca é silencioso.** O MKT-09B §8 exige isso e é fácil
de violar sem perceber. Se o primário cai, o resultado volta com
`fallback_used` e o motivo. Em decisão material, o fallback só acontece com
autorização explícita — caso contrário a chamada falha, porque trocar de modelo
sem avisar numa decisão que importa é pior que falhar.

O orçamento é verificado **antes** da chamada, não na conta do fim do mês. E
workspace sem orçamento configurado devolve `NULL`, não zero: um significa "sem
teto definido", o outro "teto atingido". Confundir os dois deixa o produto
gastar às cegas — há teste para isso.

**4. Replay não duplica.** A idempotência não está no workflow; está no
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

**Nenhuma tabela do schema fica sem RLS** — e isso é testado, não combinado.
`mkt.processed_events` nasceu sem: não tem `org_id`, então não passou pelo helper
`enable_org_rls()`, e ninguém ligou na mão. No Supabase isso significa tabela
legível e gravável por qualquer um com a anon key. O advisor encontrou depois de
o schema já estar aplicado em banco. A correção pontual está em `0005` e `0008`;
o que impede a repetição é o teste que varre `pg_class` e falha se qualquer
tabela do schema tiver `relrowsecurity = false`. Sem `org_id` não é desculpa:
liga-se a RLS sem policy, e só `service_role` (que tem `BYPASSRLS`) passa.

### Schemas paralelos

Os `.sql` são a fonte única e usam `mkt.` literalmente, para continuarem
executáveis direto no psql. Para materializar a mesma estrutura sob outro nome:

```bash
MKT_SCHEMA=mkt_v2 npm run db:migrate:local
```

O runner reescreve apenas o token `mkt` quando ele aparece como qualificador de
schema — nomes que só contêm "mkt" ficam intactos, e há teste para isso. Cada
schema alternativo é uma cópia completa e independente: enums, funções, policies
e triggers próprios. Um `insert` em um não aparece no outro.

Isso serve para evoluir uma versão sem tocar na que está de pé. **Não é
mecanismo de migração de dados** — copia estrutura, não linhas.

### Aplicar sem CLI

Para um projeto Supabase que você não quer (ou não pode) alcançar por linha de
comando, gere um `.sql` único e cole no SQL Editor:

```bash
MKT_SCHEMA=mkt_v2 npm run db:bundle
# -> packages/db/dist/mkt_v2.sql

# Incremental, para quem já aplicou as anteriores:
MKT_SCHEMA=mkt_v2 MKT_ONLY=0007,0008 npm run db:bundle
```

O bundle roda inteiro dentro de uma transação: ou entra completo, ou não entra
nada. Rodar duas vezes falha no primeiro `create type` e faz rollback — o schema
existente fica exatamente como estava, sem duplicar seed. Testado contra um banco
que já tinha `mkt` e `rh` populados: nenhum dos dois foi tocado.

## O que falta para fechar a Fase 1

**Uma coisa, e ela não é código: submeter o app na Meta.** Caminho crítico,
duas a seis semanas (ADR-0008). Até lá o produto roda inteiro com
`META_ADAPTER=fake` — o adapter falso implementa o mesmo contrato e o gateway
não distingue um do outro. Foi para isso que essa fronteira existe.

Já fechado: schema aplicado (8 migrations, 29 tabelas, nenhuma sem RLS),
adapter real do Meta Graph, tela de aprovação, outbox ligado ao Inngest, e os
produtores que alimentam as duas filas.

O Gate G1 existe e é executável: `npm run gate:g1`, 10/10 nos critérios
verificáveis. Ele **não se declara fechado** — o post real numa conta real
depende da Meta, e o gate diz isso toda vez que roda. Ver `docs/GATE-G1.md`.

### O que ainda depende de decisão sua

1. **Promover um agent para `ACTIVE`.** Os quatro nascem `CANDIDATE`. Em
   `CANDIDATE` eles rodam apenas com `internal: true`, que a rota `/api/agent`
   permite só para `OWNER` — dá para exercitar, não para servir usuário.
   Promover é ato de governança deliberado.

### O que falta de infraestrutura

3. **App web além da tela de aprovação.** Sem home, sem login, sem listagem de
   conteúdo. `SUPABASE_JWT_SECRET` precisa estar configurado para a sessão
   funcionar.
4. **Brand Brain a partir de URL** — Fase 2, depois da Meta liberada.

O endpoint durável do Inngest já está servido em
`apps/web/app/api/inngest/route.ts`; falta só configurar `INNGEST_EVENT_KEY` e
`INNGEST_SIGNING_KEY` no deploy.

## Rastreabilidade

Toda decisão material aponta para a fonte: MKT-01 a MKT-09B nos comentários das
migrations e dos schemas, MKT-17 nas ADRs. Nenhuma regra crítica vive apenas em
prompt — que é o que a Definition of Done do MKT-SPEC-STANDARD-01 exige.
