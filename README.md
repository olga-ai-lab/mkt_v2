# Olga Marketing OS

Sistema de marketing operado por **quatro agentes governados**, para corretoras
de seguros. Implementação do plano MKT-17 — Fase 0 (Fundação) e Fase 1 (Walking
skeleton) fechadas, módulo de agente construído.

### 👉 Comece por aqui

| | |
|---|---|
| **[`AGENTS.md`](AGENTS.md)** | Os quatro agentes: o que cada um faz, o que cada um NÃO faz, e onde cada parte deles mora |
| **[`CLAUDE.md`](CLAUDE.md)** | Como trabalhar neste repositório: invariantes, convenções, o que rodar antes de dizer que terminou |
| **[`docs/ROADMAP.md`](docs/ROADMAP.md)** | O que falta construir, com a procedência de cada item: o que veio do MKT-17, o que é derivado do código, e o que é proposta minha esperando confirmação |
| **[`docs/HANDOFF.md`](docs/HANDOFF.md)** | Estado atual, acessos ao Supabase, e o que falta — separado por dono |
| **[`docs/adr/`](docs/adr/)** | 12 decisões de arquitetura, com o que foi recusado e por quê |

> O LLM interpreta; os contratos decidem; o código calcula; as ferramentas
> executam; a evidência sustenta.

Este repositório existe para transformar esse princípio em algo que quebra
quando alguém o contraria. Um schema JSON validado em CI é mais normativo que
um PDF aprovado.

---

## Onde o projeto está

**419 testes, 24 evals de agente, Gate G0 10/10, Gate G1 10/10 verificáveis.**

O esqueleto anda de ponta a ponta — pedir aprovação → aprovar → agendar → outbox
→ workflow → gateway → adapter → publicado — provado contra Postgres em
`packages/db/test/pipeline.test.mjs`.

Sobre ele roda o loop de agente com as nove interfaces da Documentação Mestra
§6, as 12 capabilities do registry com compilador determinístico, e evals golden
e adversarial por agente rodando contra banco de verdade.

| Peça | O que faz | Prova |
|---|---|---|
| `packages/contracts` | JSON Schema dos objetos de I/O, dos registries e dos enums fechados. Tipos TS gerados | 15 testes |
| `packages/policy` | Policy engine determinístico: invariantes de código + regras como dado, default deny | 19 testes |
| `packages/gateway` | Capability Gateway (8 passos do MKT-09B §10) + adapters: `internal`, `meta_graph`, `web_fetch` com defesa de SSRF | 92 testes |
| `packages/runtime` | Model Gateway, loop de agente, compiladores, retrieval, redator, evals | 110 testes |
| `packages/db` | 10 migrations, 29 tabelas, RLS forçada, state machine em trigger | 137 testes |
| `apps/worker` | Workflow durável de publicação, replay-safe, relay do outbox | 25 testes |
| `apps/web` | Next.js: home, conteúdo, aprovações, Brand Brain, login | 21 testes |
| `docs/adr` | 12 ADRs fechando o que o MKT-09B deixava OPEN | — |

### O que ainda não está pronto — sem rodeio

- **Só o `AGT-MKT-COPILOT` está `ACTIVE`, e ele só lê.** Nenhum agente escreve em
  produção hoje. Os outros três rodam em modo interno (`OWNER` apenas). Promover
  um que escreve é ato de governança com migration própria.
- **Faltam três telas:** criar conteúdo, conectar canal, e ver o trace de uma
  execução. A do Brand Brain já existe. Ver [`docs/ROADMAP.md`](docs/ROADMAP.md).
- **O Gate G1 não fecha por código.** Falta um post real numa conta real, e isso
  depende do app review da Meta (ADR-0008).
- **Fase 2 e 3 não começaram:** plano editorial, geração em lote, calendário,
  LinkedIn, geração de imagem, RSS.

`npm run gate:g0` e `npm run gate:g1` verificam os critérios executando cada um
deles — nenhum dos dois aceita checklist em prosa.

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

### Agentes

Os quatro nascem `CANDIDATE`. O **COPILOT foi promovido para `ACTIVE`** pela
migration `0009`, com o motivo registrado nela: é o único cujo charter é só
leitura, então a promoção não amplia superfície de efeito.

Os outros três seguem `CANDIDATE` — dois deles têm capability de escrita, e
promover cada um é decisão separada, com migration e motivo próprios. Há teste
que derruba a suíte se um agente com escrita aparecer `ACTIVE`, e a `0009`
checa o mesmo no banco.

**Retrieval:** o agente lê o Brand Brain ACTIVE da marca, e só o que a
intenção pede. `CONNECT_CHANNEL` não recebe contexto nenhum, de propósito. O
que vem de lá entra como material na quinta camada de contexto — nunca como
instrução de sistema.

**Evals:** `npm run evals`. Casos em `packages/runtime/evals/<agente>.json`,
rodados contra o banco real — só a resposta do modelo é roteirizada. Eles medem
governança (parou onde devia? recusou o que devia?), não qualidade de texto;
essa depende do golden dataset da Fase 2, com as corretoras piloto.

### O que ainda depende de decisão sua

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
