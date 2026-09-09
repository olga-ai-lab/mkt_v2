# Roadmap — o que falta construir, e o que é chute

Este arquivo existe porque a resposta honesta para "temos visão completa do
plano?" era **não**. O repositório tinha gates executáveis para a Fase 0 e a
Fase 1 e nada escrito sobre o resto — só menções soltas em três arquivos.

## Como ler este documento

Cada item traz uma marca de procedência, e ela importa:

| Marca | Significa |
|---|---|
| **[MKT-17]** | Está no plano de construção que a Olga entregou. Não é interpretação. |
| **[Mestra]** | Está na Documentação Mestra de Engenharia de Agentes V11. |
| **[derivado]** | Consequência direta de algo já construído. Não estava no plano; apareceu porque o código pediu. |
| **[proposto]** | **Minha inferência.** Não veio de documento nenhum. Precisa da sua confirmação antes de virar trabalho. |

Um roadmap que não separa essas quatro coisas é um roadmap em que o que alguém
decidiu e o que uma IA supôs têm o mesmo peso. Aqui não têm.

---

## Onde estamos

Fase 0 (Fundação) e Fase 1 (Walking skeleton) fechadas nos critérios que são
código: `npm run gate:g0` e `npm run gate:g1`, 10/10 cada um.

**O G1 não fecha por código.** Falta um post real numa conta real, e isso
depende do app review da Meta (ADR-0008). O gate diz isso em vez de mostrar
verde — um gate que se declara fechado com critério faltando cria confiança sem
lastro.

---

## Bloco A — o que impede o produto de ser usado hoje

Este bloco não é Fase 2. É o que sobrou da Fase 1 quando o backend passou a
funcionar e a interface não acompanhou.

| # | Item | Procedência | Estado |
|---|---|---|---|
| A1 | Tela do Brand Brain: revisar e promover a versão CANDIDATE | **[derivado]** | ✅ feito |
| A2 | Tela de criar conteúdo (disparar o agente e ver o rascunho) | **[derivado]** | ✅ feito |
| A3 | Tela de conectar canal (OAuth da Meta) | **[MKT-17]** | ✅ código feito, **desligado** — depende da Meta |
| A4 | Ver o trace de uma execução: plano, passos, evidência, receipts | **[Mestra]** | ✅ feito |

**O bloco A está fechado em código.** O que sobra dele não é código.

**A2** manda para `POST /api/agent`, a entrada única do runtime, e mostra o
status do agente lido do registry: enquanto o CONTENT for `CANDIDATE`, a tela
diz isso e por quê, em vez de oferecer um botão que só devolve
`AGENT_NOT_ACTIVE`.

**A4** era a mais atrasada em consequência: a Mestra pede rastreabilidade do
pedido ao efeito, os dados sempre existiram — cinco tabelas compartilham
`trace_id` — e auditar exigia escrever SQL sabendo quais eram as cinco. Ao
construir a tela apareceu que `mkt.audit_events` **não tinha produtor nenhum**:
existia desde a migration 0004, com RLS e teste de RLS, e nunca recebeu uma
linha em produção. Hoje tem três produtores, e a decisão humana — que não deixa
receipt nem evento — passou a estar no trace.

**A3 entra pronto e desligado.** As rotas de OAuth, a tela de canais e o vault
com escrita (ADR-0014) existem; `META_ADAPTER=fake` continua o padrão, e a tela
diz as três condições que faltam em vez de levar a um erro da Meta. O
obstáculo que ele revelou merece registro: havia **um** resolvedor de segredo,
por variável de ambiente, e ele não grava — um callback de OAuth recebe o token
em tempo de execução, e sem porta de escrita a saída mais fácil seria guardá-lo
no banco de domínio.

---

## Bloco B — promover os agentes que escrevem

**Dois agentes estão `ACTIVE`, os dois `{read,simulate}`:** COPILOT (migration
0009) e COMPLIANCE (0012). Nenhum deles cria conteúdo, agenda, aprova ou
publica. Isso não é o sistema quebrado: é a governança funcionando.

Com a migration 0011, `quality.precheck` passou a ter efeito interno — ela
registra que a revisão de IA aconteceu — e está no charter do COPILOT. O
invariante que vale hoje, com teste próprio, é: nenhum agente ACTIVE alcança
efeito externo, e a única capability de efeito interno permitida a um deles está
nomeada no teste.

| # | Item | Procedência | Bloqueio |
|---|---|---|---|
| B1 | Promover `AGT-MKT-COMPLIANCE` | **[proposto]** | ✅ feito na migration 0012 |
| B2 | Promover `AGT-MKT-BRAND` | **[proposto]** | ✅ feito na migration 0013 |
| B3 | Promover `AGT-MKT-CONTENT` | **[proposto]** | ✅ feito na migration 0013 |

**O bloco B está fechado**, e a `0013` fez mais que promover: trocou o teto.

A guarda das `0009` e `0012` recusava qualquer agente `ACTIVE` com capability de
escrita — e ela não podia ser reexecutada na `0013`, porque abortaria. Isso não
é obstáculo a contornar: é a pergunta que a guarda existe para forçar. Ou a
promoção não acontece, ou alguém declara qual invariante fica no lugar.

O que ficou é mais estreito e mais forte, e sai de `side_effect` no registry:
**nenhum agente `ACTIVE` tem capability de efeito externo.** Uma capability que
ganhe efeito externo amanhã passa a ser barrada sem que ninguém edite a guarda.

A promoção revelou um defeito que valia mais que ela: o policy engine
perguntava pelo MODO (`capability_mode === "write"`) onde o comentário dizia
EFEITO. O ramo era inalcançável enquanto nenhum agente que escreve estava
`ACTIVE`, então o proxy passava por correto — e com CONTENT promovido, todo
rascunho virava pedido de aprovação. Quem achou foi o eval `CONTENT-GOLD-001`.

Os evals dos quatro já existem e passam — há teste exigindo que todo agente
ACTIVE tenha eval próprio. Promover sem medir é promover no escuro; medir sem
promover é o estado de agora.

---

## Bloco C — Fase 2

| # | Item | Procedência |
|---|---|---|
| C1 | Golden dataset de qualidade, com as três corretoras piloto | **[MKT-17, achado G11]** |
| C2 | Plano editorial: calendário e geração em lote | **[MKT-17]** — ✅ feito |
| C3 | Agendamento recorrente | **[MKT-17]** — ✅ feito |
| C4 | Instrumentação de custo por capability, não só por run | **[derivado]** — ✅ feito |

**C1 é o que fecha o achado G11 de verdade.** A parte executável — evals de
governança, determinísticos, rodando em CI — está feita. A parte estatística
não: ela exige chamada real ao modelo, custa dinheiro por execução, e precisa do
julgamento das corretoras sobre o que é um bom texto. As duas suítes são
separadas de propósito: misturar produz uma suíte que ninguém confia porque
falha por motivo aleatório.

**C4 está feito** (migration 0014): `model_spend` ganhou `capability_id`, e nulo
é informação — resolver, planner e responder são o loop pensando, e não rodam
sob capability nenhuma. É isso que separa custo de pensar de custo de produzir.

**C3 obrigou a decidir o que "recorrente" pode significar.** A state machine não
deixa republicar a mesma versão — `PUBLISHED` é terminal, e a aprovação é
vinculada à versão. Então recorrência aqui é um **slot** no calendário: cada
ocorrência consome a próxima versão aprovada do canal. Slot sem conteúdo
aprovado não publica nada, e isso é estado esperado, não falha.

**C2 é a única parte do produto em que um clique gasta dinheiro N vezes.** O
lote para na primeira recusa de orçamento em vez de tentar os seguintes, e os
não tentados voltam marcados como tal — a tela precisa distinguir "tentou e não
deu" de "nem chegou a tentar".

**Sobra o C1**, e ele continua dependendo de corretora piloto julgando texto.

---

## Bloco D — Fase 3

| # | Item | Procedência |
|---|---|---|
| D1 | LinkedIn como segundo canal | **[MKT-17]** |
| D2 | Upload de arquivo e foto | **[MKT-17]** |
| D3 | Geração de imagem | **[MKT-17]** |
| D4 | COMPLIANCE completo (hoje são checks determinísticos básicos) | **[MKT-17]** |
| D5 | Ingestão por RSS | **[MKT-17]** |
| D6 | UI de configuração de autonomia por workspace | **[Mestra]** |
| D7 | Fila de aprovação por risco e SLA | **[MKT-17]** |

**D3 é o ponto de revisão da ADR-0002.** Geração de imagem é execução longa, e
função serverless com teto de tempo não serve. É aí que a conversa sobre
plataforma (ADR-0012, Railway) deixa de ser hipotética.

---

## Dívidas conhecidas, sem fase

| O quê | Por que ainda está aí |
|---|---|
| O Supabase Vault não é exercido por teste | `vault.create_secret` vem da extensão `supabase_vault`, que não existe no Postgres da CI. O que está provado é a forma das chamadas, contra um dublê. Fechar isso exige um Postgres de teste com a extensão, ou um teste de fumaça contra o projeto Supabase. |
| Check de disclaimers exige *todos* quando há claim material | A lista é de strings soltas e não diz qual disclaimer cobre qual tipo de claim. Erra para o lado de mandar para revisão humana, que é o erro barato. Mapear por `claim_type` depende de o Brand Brain ganhar essa estrutura. |
| `activated_by` só existe em `brand_brain_versions` | É a única tabela em que a ativação é o momento em que um humano assume responsabilidade por um artefato que o agente escreveu. Se outra passar a ter esse momento, ganha a coluna. |

---

## A ordem que eu seguiria, e por quê

Os quatro primeiros itens desta lista foram feitos: A2, A4, B1 e o código de
A3. O que sobrou dela é o que depende de decisão ou de terceiro.

1. ~~**A2 e A4**~~ — feitos. A4 primeiro, de propósito: promover um agente que
   escreve sem ter onde ver o que ele fez é promover sem instrumento.
2. ~~**B1, B2 e B3**~~ — feitos nas migrations 0012 e 0013.
3. ~~**C4, C3 e C2**~~ — feitos, nessa ordem: sem custo por capability, um lote
   produz fatura que ninguém decompõe.
4. **O app review da Meta** — o código de A3 está pronto e desligado. Este é o
   caminho crítico e o relógio mais lento, e continua não sendo código. É a
   única coisa entre o produto e o Gate G1 fechado.
5. **C1** — quando houver corretora piloto de verdade para julgar texto.

Depois disso, o bloco D. **D6 (UI de autonomia por workspace) subiu de
prioridade** com os quatro agentes `ACTIVE`: hoje o teto de cada um vem do
registry e só muda por migration.

Os blocos C e D estão em ordem de documento, não de prioridade. Reordenar é
decisão de produto, e ela é sua.
