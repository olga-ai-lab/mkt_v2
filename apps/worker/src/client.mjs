/**
 * Cliente Inngest (ADR-0001).
 *
 * Fica separado do registro das funcoes porque quem PUBLICA evento (o app web,
 * ao agendar) e quem CONSOME (o endpoint durável) precisam do mesmo cliente,
 * mas nao do mesmo conjunto de funcoes.
 *
 * `eventKey` so e exigido para enviar. Em desenvolvimento, o Dev Server do
 * Inngest aceita sem chave — por isso a ausencia nao derruba a montagem aqui,
 * ao contrario das portas de banco, cuja falta e sempre bug.
 */
import { Inngest } from "inngest";

export const EVENT_PUBLISH_REQUESTED = "olga/content.publish.requested";
export const EVENT_PUBLISHED = "olga/content.published";
export const EVENT_PUBLISH_BLOCKED = "olga/content.publish.blocked";
export const EVENT_PUBLISH_FAILED = "olga/content.publish.failed";

export function createInngestClient({ env = process.env } = {}) {
  return new Inngest({
    id: "olga-marketing-os",
    eventKey: env.INNGEST_EVENT_KEY,
    isDev: env.INNGEST_DEV === "1" || env.NODE_ENV !== "production",
  });
}
