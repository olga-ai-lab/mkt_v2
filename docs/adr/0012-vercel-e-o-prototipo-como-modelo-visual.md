# ADR-0012 — Vercel hospeda o produto; o protótipo é o modelo visual

- **Status:** ACEITA
- **Data:** 28/08/2026
- **Fecha:** onde o produto roda, e de onde sai a paleta

## Contexto

O front foi desenhado no Lovable, que criou o repositório `olga-ai-lab/marketplace-sync` em vez de sincronizar com este. O fluxo da casa é desenhar lá, conectar no git, codar com o Claude — **e hospedar no Lovable**.

Duas descobertas mudam o desenho:

**1. O Lovable hospeda em Cloudflare Workers.** O `vite.config.ts` dele diz `nitro (build-only using cloudflare as a default target)`, e o `src/server.ts` exporta `fetch(request, env, ctx)`, que é assinatura de Worker. Três coisas do `mkt_v2` não rodam lá:

| Onde | O quê | Por quê |
|---|---|---|
| `apps/web/lib/db.ts` | `new Pool()` do `pg` | abre socket TCP; Workers não tem. Toda porta e toda rota de API passam por aqui |
| `packages/contracts/src/index.mjs` | `readdirSync` + `readFileSync` do diretório de schemas | não há `node:fs` |
| `packages/gateway/src/adapters/web-fetch.mjs` | `node:dns` + `node:net` | é a defesa de SSRF: resolve o host e recusa IP privado antes de buscar |

O terceiro é o que pesa. A "solução" preguiçosa é remover a checagem — e aí o `brand.extract_from_url`, que busca uma URL, vira proxy para a rede interna do ambiente.

**2. A paleta divergiu.** `tokens.css` foi escrito a partir do MKT-06A §3. O protótipo derivou uma paleta parecida mas diferente: ink mais escuro (`#0E353D` contra `#0B2630`), teal mais vivo (`#0A8583` contra `#0A5D5A`), e um índigo e um ciano que a especificação não previa.

## Decisão

**O produto é hospedado na Vercel.** O Lovable continua hospedando o protótipo, que é o que ele já hospeda hoje e o que ele sabe hospedar: mock, sem backend, uma URL para mostrar.

**O protótipo passa a ser o modelo visual.** O MKT-06A §3 está superado: os valores de `apps/web/styles/tokens.css` saem de `apps/web/mktos/`, medidos por frequência de uso, não escolhidos.

Os **nomes** dos tokens não mudaram — nenhum componente precisou ser tocado, e o diff mostra só o que mudou: cor.

## Alternativas consideradas

**Portar o backend para Workers** para manter tudo no Lovable. É possível: trocar `lib/db.ts` por driver HTTP (Supabase JS ou Hyperdrive), trocar o carregamento de schemas para import estático, e resolver o SSRF sem `node:dns`. Os dois primeiros são mecânicos. O terceiro é decisão de segurança, e não se toma uma para economizar um deploy.

**Manter as duas paletas**, cada uma no seu lugar. É o pior dos mundos: de longe ninguém percebe a diferença, e de perto nenhuma tela combina com a outra.

**Voltar o protótipo para o MKT-06A.** Seria refazer à mão o que já está desenhado, e a próxima rodada no Lovable desfaria — porque lá o modelo é o do protótipo.

## Consequências e ponto de revisão

Dois lugares de deploy, e a fronteira é clara: o que tem banco atrás vai para a Vercel; o que é desenho fica no Lovable.

**Plano Hobby tem limite de tempo de função.** Um run de agente chama o modelo três vezes (resolver, planner, responder), mais retrieval e gateway. É I/O, não CPU, mas o limite é de parede — `/api/agent` é a rota a observar primeiro, e a que justifica subir de plano se estourar.

O acoplamento visual é um arquivo: `tokens.css`. Se o modelo mudar, muda ali, e a mudança chega por `npm run sync:prototipo` — não por alguém redigitar hex. `apps/web/test/tokens.test.mjs` recusa cor escrita fora do `:root` e recusa estado do enum sem regra de chip.

Rever quando: o app review da Meta sair e o volume de publicação justificar medir o tempo de função; ou quando alguma tela do protótipo virar produto e a paleta precisar de token que ainda não existe.
