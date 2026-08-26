/**
 * Adapters de provider.
 *
 * ── O contrato ──────────────────────────────────────────────────────────────
 *
 * Um adapter e um objeto com um metodo:
 *
 *   call({ capability, request, idempotency_key, trace_id })
 *     -> { external_id: string, request_hash?: string }
 *     -> lanca CapabilityError em qualquer falha
 *
 * O Capability Gateway nao sabe qual adapter esta chamando. Essa e a prova de
 * que a fronteira esta no lugar certo: o falso e o real entram pela mesma
 * porta, e trocar um pelo outro nao muda uma linha do gateway.
 *
 * ── O que o adapter PODE decidir ────────────────────────────────────────────
 *
 * Uma coisa so, e ela e a que importa: se a falha e segura para tentar de novo.
 * O gateway obedece `retryable` sem discutir, entao mentir aqui vira post
 * duplicado la. Ver o comentario longo em meta-graph.mjs sobre a diferenca
 * entre falhar criando o rascunho e falhar publicando.
 *
 * ── O que o adapter NAO faz ─────────────────────────────────────────────────
 *
 * Nao aplica policy, nao decide autonomia, nao grava receipt, nao deduplica.
 * Tudo isso ja aconteceu antes de ele ser chamado. Um adapter que precisa
 * saber de policy e sinal de que a fronteira escorregou.
 */
export { createMetaGraphAdapter } from "./meta-graph.mjs";
export { createFakeMetaAdapter } from "./fake-meta.mjs";
export { createWebFetchAdapter, ehPublico, validarAlvo, extrairTexto } from "./web-fetch.mjs";
