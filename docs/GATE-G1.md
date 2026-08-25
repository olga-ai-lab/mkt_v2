# Gate G1 — Walking skeleton

O critério vem do MKT-17, Fase 1, e está reproduzido aqui literalmente porque
é ele que decide, não a paráfrase:

> um post real publicado numa conta real; receipt com external ID do provider;
> trace completo do pedido ao efeito; e um teste que dispara o replay do
> workflow e prova que não houve segunda publicação.

São quatro exigências. `npm run gate:g1` verifica as três que são código e
**declara a quarta como aberta**, sempre.

## Por que o gate não fecha sozinho

O post real numa conta real depende da submissão do app na Meta (ADR-0008),
que é prazo externo de duas a seis semanas. Nenhuma linha de código encurta
isso.

O gate podia ter sido escrito para ignorar esse item e mostrar verde. Não foi,
por um motivo simples: **um gate que se declara fechado com um critério
faltando é pior que gate nenhum**, porque cria confiança sem lastro. Enquanto
a Meta não liberar, `gate:g1` termina dizendo o que falta, mesmo com todo o
resto passando.

## O que ele verifica hoje

| Critério | Onde é provado |
|---|---|
| Receipt com external ID do provider | `packages/db/test/pipeline.test.mjs` |
| Trace liga pedido → execução → efeito → aviso | idem, mesmo teste |
| Replay do workflow não republica | `apps/worker/test/publish-workflow.test.mjs` |
| Reentrega do outbox não republica | `apps/worker/test/outbox-relay.test.mjs` |
| O caminho inteiro roda contra Postgres | `packages/db/test/pipeline.test.mjs` |
| Aprovação cai quando o conteúdo muda | `packages/db/test/approvals.test.mjs` |
| As três capabilities da Fase 1 estão ACTIVE | `packages/db/migrations/0006` |
| Efeito externo só pelo Capability Gateway | `packages/gateway/test/` |
| Adapter real e falso pela mesma porta | `packages/gateway/test/meta-graph.test.mjs` |
| O sistema monta de verdade | `packages/db/test/composition.test.mjs` |

Os dois primeiros são medidos numa passagem só, e isso é de propósito: um
trace que não chega ao receipt não prova nada, e um receipt sem `external_id`
não prova efeito. Separá-los deixaria passar meia prova.

## Quando a Meta liberar

1. Configurar as credenciais e `META_ADAPTER=real`.
2. Publicar um post numa conta de teste real.
3. Conferir que o receipt traz o ID do post do provider e que o trace vai do
   pedido até ele.
4. Rodar o replay contra a mesma conta e confirmar que não sai um segundo post.

Só então o G1 fecha.
