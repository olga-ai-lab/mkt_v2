/**
 * Adapter de provider. Fino de proposito: roteamento, orcamento, fallback e
 * contabilidade sao do Model Gateway, nao daqui.
 */
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
          system: messages.find((m) => m.role === "system")?.content,
          messages: messages.filter((m) => m.role !== "system"),
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
