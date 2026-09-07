# ADR-0013 — `quality.precheck` registra a revisão de IA

- **Status:** ACEITA
- **Data:** 07/09/2026
- **Fecha:** a dívida "nada move `DRAFT` → `AI_REVIEW`", registrada em
  `docs/ROADMAP.md` e em `docs/HANDOFF.md`

## Contexto

A state machine da J11 (`0002_brand_content.sql`) só deixa `DRAFT` sair para
`AI_REVIEW` ou `CANCELLED`. A porta `requestApproval` exige `AI_REVIEW` ou
adiante, e recusa com `CONTENT_NOT_APPROVED` dizendo, com todas as letras,
"falta passar por AI_REVIEW".

Ninguém fazia essa passagem. Medido contra Postgres: **todo conteúdo criado por
agente ficava preso em `DRAFT` para sempre.** O caminho de ponta a ponta do
`pipeline.test.mjs` só andava porque o próprio teste posicionava o estado com um
`UPDATE`. Um teste que prepara o estado que o produto não sabe alcançar prova o
trecho depois dele e esconde o trecho antes — foi assim que isto sobreviveu a
uma suíte verde.

O ROADMAP já nomeava a causa: `quality.precheck` é a revisão de IA em intenção,
mas seu `side_effect` era `none` no registry, e capability que não escreve não
muda estado.

## Decisão

`quality.precheck` v1 passa a declarar `side_effect = 'internal'` (migration
0011), e o handler correspondente move `DRAFT` → `AI_REVIEW` **quando o laudo
passa**.

A ordem é a do princípio do repositório: o registry declara primeiro, o código
escreve depois. Declarar depois de escrever seria o código contando ao registry
o que ele faz.

Três recusas fazem parte da decisão:

- **Laudo que reprova não promove nada.** Um precheck que movesse o conteúdo
  adiante mesmo reprovando transformaria "conferi e achei problema" em
  "conferi" — o único resultado pior que não conferir.
- **Conteúdo que já saiu de `DRAFT` não volta.** Revisão de IA reexecutada não
  desfaz o que um humano já decidiu.
- **O estado resultante não entra no laudo.** `olga://io/validated-result` fecha
  o objeto com `additionalProperties: false`, e está certo: um laudo diz o que
  foi conferido. Em que estado o conteúdo ficou é outra pergunta, e ela se
  responde no trace.

## Alternativas consideradas

**Mudar `mode` de `simulate` para `write`.** Parecia mais honesto — a capability
agora escreve. É um erro: o gate que para o loop diante de um laudo reprovado
está em `agent-loop.mjs` e é ligado ao **modo**:

```js
if (cap.mode === "simulate" && saida.output?.valid === false)
```

Em modo `write`, o precheck deixaria de ser lido como laudo, e conteúdo com
claim material sem lastro voltaria a seguir adiante em silêncio. O incômodo de
um `simulate` que grava é menor que o custo de desligar aquele gate.

A leitura das duas colunas que sustenta a escolha: `mode` diz que ato é aquele
do ponto de vista do agente — ele simula, não decide nada lá fora. `side_effect`
diz se há consequência de estado — e há uma, interna: registrar que a revisão de
IA aconteceu.

**Uma capability nova só para transicionar** (`content.mark_reviewed`).
Recusada: criaria um segundo lugar para a mesma verdade, e nada impediria alguém
de chamá-la sem ter rodado o precheck — que é exatamente a transição sem revisão
que a state machine existe para impedir.

## Consequências e ponto de revisão

O produto passa a andar de ponta a ponta sem intervenção manual em banco:
agente cria rascunho → precheck aprova e registra a revisão → pedido de
aprovação alcança a fila humana → aprovação → agendamento → publicação.

Rever quando `AGT-MKT-COMPLIANCE` operar em produção: hoje `compliance.review`
é `simulate`/`none` e apenas relata. Se a revisão de compliance também passar a
ter consequência de estado, ela entra por decisão própria — não por analogia com
esta.
