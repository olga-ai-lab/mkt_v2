/**
 * Adapter falso do Meta.
 *
 * Existe por um motivo que nao e conveniencia de teste: enquanto o app review
 * da Meta nao sai (ADR-0008), o produto inteiro precisa rodar de ponta a ponta.
 * Se o falso e o real entram pela mesma porta do gateway, a espera pela Meta
 * nao bloqueia mais nada — e o dia em que o real entrar, nao ha integracao a
 * fazer, ha um nome de adapter a trocar.
 *
 * Ele imita o CONTRATO, incluindo as falhas: da para pedir que ele estoure com
 * um reason code e uma classificacao de retry especificos, que e o unico jeito
 * de testar o comportamento do gateway diante de cada tipo de erro.
 */
import { CapabilityError } from "../index.mjs";
import { hashRequest } from "./meta-graph.mjs";

/**
 * @param {{ failWith?: { reason_code: string, retryable?: boolean, error_class?: string }|null,
 *           failTimes?: number, idPrefix?: string, onCall?: (info: any) => void }} [opcoes]
 */
export function createFakeMetaAdapter({
  failWith = null, failTimes = Infinity, idPrefix = "ig", onCall,
} = {}) {
  const calls = [];

  return {
    name: "meta_graph_fake",
    calls,

    async call({ capability, request, idempotency_key, trace_id }) {
      const { channel, connection_id, channel_variant_id } = request.args ?? {};
      calls.push({ idempotency_key, channel, trace_id });
      onCall?.({ idempotency_key, channel, trace_id, request });

      if (failWith && calls.length <= failTimes) {
        throw new CapabilityError(failWith.reason_code, failWith.reason_code, {
          error_class: failWith.error_class ?? (failWith.retryable ? "TRANSIENT" : "PERMANENT"),
          retryable: failWith.retryable ?? false,
        });
      }

      return {
        external_id: `${idPrefix}_${calls.length}`,
        request_hash: hashRequest({ channel, connection_id, channel_variant_id }),
      };
    },
  };
}
