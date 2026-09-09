# ADR-0012 — Railway para a web (supersede a ADR-0002)

- **Status:** ACEITA em 08/09/2026, por decisão da Olga.
- **Supersede:** a parte da ADR-0002 sobre onde a web roda.
- **Data:** 26/08/2026
- **Revisa:** ADR-0002 (Vercel para a web, Inngest Cloud para o worker)

## A decisão, e o que ela contraria

A Olga decidiu ir para o Railway. **A recomendação desta ADR era a oposta** —
ficar na Vercel até a Fase 3 —, e ela fica preservada abaixo, inteira. Uma ADR
que apaga o conselho que não foi seguido perde a metade útil: daqui a seis meses,
quem ler precisa saber que a alternativa foi considerada e por quais razões, para
poder julgar se elas ainda valem.

O que a decisão **não** muda: o Inngest continua sendo o motor durável
(ADR-0001). Railway substituiu a Vercel; os dois nunca foram alternativas um do
outro.

## Por que esta ADR nasceu como PROPOSTA

A pergunta "nosso agente está no Railway?" apareceu nesta sessão. A resposta
factual é: **não há configuração de deploy nenhuma no repositório** — nem
`railway.toml`, nem `vercel.json`, nem `Dockerfile`, nem `Procfile`. O único
registro de intenção é a ADR-0002, que está ACEITA e diz outra coisa.

Uma ADR registra decisão tomada. Não houve decisão de mudar para Railway; houve
uma pergunta. Escrever "Status: ACEITA" aqui seria inventar um registro de
governança — exatamente o tipo de coisa que o resto deste repositório existe
para impedir. Então isto fica como proposta até alguém decidir.

## O que muda, se mudar

A ADR-0002 escolheu duas plataformas para duas cargas diferentes:

| | Hoje (ADR-0002) | Se for Railway |
|---|---|---|
| `apps/web` (Next.js) | Vercel | Railway |
| `apps/worker` (funções duráveis) | Inngest Cloud | ver abaixo |

O ponto que decide não é a web — Next.js roda nos dois. É o **worker**.

`apps/worker` não é um processo que fica de pé escutando. São funções duráveis
Inngest (ADR-0001), servidas por um endpoint HTTP em
`apps/web/app/api/inngest/route.ts`. Quem invoca, faz retry, guarda o estado
entre passos e replaya em falha é o Inngest — não a plataforma de hospedagem.

Isso significa que **Railway e Inngest Cloud não são alternativas uma da
outra.** Railway substituiria a Vercel; o Inngest continua sendo o motor
durável nos dois casos. Trocar o Inngest é outra decisão, e ela mexeria na
ADR-0001, não nesta.

## O que ganharia, e o que custaria

**A favor do Railway:**

- Um lugar só para web, worker e qualquer processo longo futuro. A ADR-0002 já
  marca ponto de revisão para "quando o media-worker exigir GPU ou execução
  longa" — e função serverless com teto de tempo é justamente o que não serve
  para gerar imagem.
- Postgres gerenciado ao lado, se um dia o Supabase deixar de bastar.
- Sem limite de duração de função para o que for HTTP comum.

**Contra:**

- A Vercel entrega preview por PR e edge sem configuração. Isso se perde.
- Railway é container: passa a existir Dockerfile, healthcheck e escala para
  cuidar. A ADR-0002 recusou ECS/Fly com o argumento de que o time não tem
  operação para dar — o argumento vale igual aqui.
- A espera pela Meta (ADR-0008) é o caminho crítico. Mudar de plataforma agora
  gasta o tempo que está sobrando por um motivo, não porque falta o que fazer.

## Recomendação

**Ficar na ADR-0002 até a Fase 3.** O motivo é o mesmo que a ADR-0002 deu, e
ele não mudou: o que trava o projeto hoje é o app review da Meta, não a
plataforma. Nada do que falta codar fica mais fácil no Railway.

O ponto de revisão continua sendo o media-worker. Quando geração de imagem
entrar, execução longa passa a ser requisito de verdade, e aí a conversa é
sobre onde roda aquele processo — possivelmente só ele, sem mover o resto.

## Como decidir

Uma frase basta, e ela vira o Status desta ADR:

 - ~~"Fica Vercel"~~ → não foi essa.
- **"Vai para Railway"** → foi essa. Esta ADR virou ACEITA, a ADR-0002 virou
  SUPERSEDIDA, e o trabalho de infraestrutura entrou: `Dockerfile`,
  `railway.toml`, healthcheck em `/api/health` e `docs/DEPLOY.md` reescrito.

## O que a construção da imagem ensinou

Construir e **rodar** a imagem — e não só escrever o `Dockerfile` — achou um
defeito que nenhum teste pegaria: `packages/contracts` lê os schemas do **disco**
em tempo de execução, e bundler nenhum rastreia leitura de arquivo. A primeira
imagem subiu, ficou saudável, e respondeu **500** no primeiro request com um
`ENOENT` dentro de um chunk do webpack.

Na Vercel isso nunca apareceu porque a plataforma sobe o repositório inteiro. É
exatamente a diferença que uma mudança de plataforma cobra, e é o argumento
concreto a favor de a verificação do deploy **rodar** a imagem.
