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
| A2 | Tela de criar conteúdo (disparar o agente e ver o rascunho) | **[derivado]** | pendente |
| A3 | Tela de conectar canal (OAuth da Meta) | **[MKT-17]** | pendente — depende da Meta |
| A4 | Ver o trace de uma execução: plano, passos, evidência, receipts | **[Mestra]** | pendente |

**A1 está feito** e fecha a cadeia do AGT-MKT-BRAND: ele lê o site, propõe
CANDIDATE, e agora existe onde uma pessoa aceitar. Sem ela, o trabalho daquele
agente terminava numa linha de banco que ninguém conseguia aceitar.

**A4 merece nota.** A Mestra pede rastreabilidade do pedido ao efeito, e os
dados existem: `agent_runs`, `mkt.outbox`, `action_receipts` e `workflow_runs`
compartilham `trace_id`. Há teste provando que a cadeia liga. O que não existe é
uma tela — hoje a auditoria é uma consulta SQL.

---

## Bloco B — promover os agentes que escrevem

**Só o `AGT-MKT-COPILOT` está `ACTIVE`, e ele só lê.** Nenhum agente escreve em
produção hoje. Isso não é o sistema quebrado: é a governança funcionando.

| # | Item | Procedência | Bloqueio |
|---|---|---|---|
| B1 | Promover `AGT-MKT-COMPLIANCE` | **[proposto]** | é o próximo natural: read+simulate, como o COPILOT |
| B2 | Promover `AGT-MKT-BRAND` | **[proposto]** | escreve — exige migration própria e motivo próprio |
| B3 | Promover `AGT-MKT-CONTENT` | **[proposto]** | escreve, e é o de maior superfície |

**Nenhum destes é decisão minha.** A migration 0009 diz por quê: ela derruba a
transação se um agente com capability de escrita estiver ACTIVE, com a mensagem
*"promover um deles exige migration própria e motivo próprio"*.

Os evals dos quatro já existem e passam — há teste exigindo que todo agente
ACTIVE tenha eval próprio. Promover sem medir é promover no escuro; medir sem
promover é o estado de agora.

---

## Bloco C — Fase 2

| # | Item | Procedência |
|---|---|---|
| C1 | Golden dataset de qualidade, com as três corretoras piloto | **[MKT-17, achado G11]** |
| C2 | Plano editorial: calendário e geração em lote | **[MKT-17]** |
| C3 | Agendamento recorrente | **[MKT-17]** |
| C4 | Instrumentação de custo por capability, não só por run | **[derivado]** |

**C1 é o que fecha o achado G11 de verdade.** A parte executável — evals de
governança, determinísticos, rodando em CI — está feita. A parte estatística
não: ela exige chamada real ao modelo, custa dinheiro por execução, e precisa do
julgamento das corretoras sobre o que é um bom texto. As duas suítes são
separadas de propósito: misturar produz uma suíte que ninguém confia porque
falha por motivo aleatório.

**C4 é [derivado]:** `mkt.model_spend` registra gasto por run e task class. Sob
qual capability o gasto aconteceu, não. Hoje não dá para responder "quanto custa
gerar um post" — só "quanto custou aquela execução".

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
| `packages/runtime/src/agent-runtime.mjs` (152 linhas, 29 testes) não é montado em lugar nenhum | O `agent-loop.mjs` o substituiu. Apagar é decisão de limpeza que ninguém tomou; mantê-lo custa manutenção de código morto em verde. |
| Nada move `DRAFT` → `AI_REVIEW` | `quality.precheck` é a revisão de IA em intenção, mas o `side_effect` dela é `none` no registry, e capability que não escreve não muda estado. Resolver é mudar o registry — migration, e decisão de governança. |
| Check de disclaimers exige *todos* quando há claim material | A lista é de strings soltas e não diz qual disclaimer cobre qual tipo de claim. Erra para o lado de mandar para revisão humana, que é o erro barato. Mapear por `claim_type` depende de o Brand Brain ganhar essa estrutura. |
| `activated_by` só existe em `brand_brain_versions` | É a única tabela em que a ativação é o momento em que um humano assume responsabilidade por um artefato que o agente escreveu. Se outra passar a ter esse momento, ganha a coluna. |

---

## A ordem que eu seguiria, e por quê

1. **A2 e A4** — sem elas o produto tem backend e não tem uso. A2 dá o botão
   que dispara o agente; A4 dá a auditoria que a Mestra pede e que hoje é SQL.
2. **B1** — o COMPLIANCE é read+simulate, como o COPILOT. Promovê-lo não amplia
   superfície de efeito e ensina o que precisa ser aprendido em operação.
3. **A3 + o app review da Meta** — é o caminho crítico e o relógio mais lento.
4. **B2 e B3** — depois de A4 existir. Promover um agente que escreve sem ter
   onde ver o que ele fez é promover sem instrumento.
5. **C1** — quando houver corretora piloto de verdade para julgar texto.

Os blocos C e D estão em ordem de documento, não de prioridade. Reordenar é
decisão de produto, e ela é sua.
