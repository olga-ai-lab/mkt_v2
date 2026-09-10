/**
 * Adapter de provider. Fino de proposito: roteamento, orcamento, fallback e
 * contabilidade sao do Model Gateway, nao daqui.
 *
 * A traducao das camadas de contexto para o corpo da API mora em
 * ./messages.mjs, que roda em teste sem rede. Ela ja foi uma linha aqui
 * dentro, e essa linha descartava duas das tres camadas de sistema — a
 * persona do agente e o contrato de saida. O comentario longo esta la.
 */
import { toAnthropicPayload } from "./messages.mjs";

type CompleteArgs = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  timeout_ms: number;
  trace_id: string;
};

export const anthropic = {
  async complete({ model, messages, timeout_ms }: CompleteArgs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout_ms);
    const payload = toAnthropicPayload(messages);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: payload.system,
          messages: payload.messages,
        }),
      });

      if (!res.ok) {
        const err: any = new Error(`anthropic ${res.status}`);
        // 429 e 5xx sao transitorios: o gateway pode tentar o fallback.
        err.transient = res.status === 429 || res.status >= 500;
        err.code = String(res.status);
        throw err;
      }

      const json = await res.json();
      return {
        content: json.content?.[0]?.text ?? "",
        input_tokens: json.usage?.input_tokens ?? 0,
        output_tokens: json.usage?.output_tokens ?? 0,
        cached: (json.usage?.cache_read_input_tokens ?? 0) > 0,
      };
    } finally {
      clearTimeout(t);
    }
  },
};
