"use client";

/**
 * Lista de conteúdo. O cliente não decide nada sobre autorização: manda o
 * pedido e mostra o que o servidor respondeu, incluindo o reason code.
 */
import { useState } from "react";

type Destino = { channel: string; channel_variant_id: string; connection_id: string };

type Item = {
  content_version_id: string;
  title: string;
  version: number;
  state: string;
  risk_tier: string;
  master_body: string;
  publicados: string[];
  destinos: Destino[];
};

const ROTULO: Record<string, string> = {
  DRAFT: "Rascunho", AI_REVIEW: "Revisão da IA", HUMAN_REVIEW: "Revisão humana",
  COMPLIANCE_REVIEW: "Revisão de compliance", APPROVED: "Aprovado",
  SCHEDULED: "Agendado", PUBLISHING: "Publicando", PUBLISHED: "Publicado",
  REJECTED: "Recusado", FAILED: "Falhou", CANCELLED: "Cancelado",
};

const MICROCOPY: Record<string, string> = {
  CONTENT_NOT_APPROVED: "Este conteúdo mudou desde que a tela carregou. Recarregue para ver o estado atual.",
  ACTOR_ROLE_FORBIDDEN: "Seu perfil não tem permissão para publicar.",
  TENANT_SCOPE_VIOLATION: "Este item pertence a outra organização.",
};

const classeDeEstado = (s: string) => `state-${s.toLowerCase().replace(/_/g, "-")}`;

export function ContentList({ itens, podePublicar }: { itens: Item[]; podePublicar: boolean }) {
  const [resultado, setResultado] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [enviando, setEnviando] = useState<string | null>(null);

  async function publicar(item: Item, destino: Destino) {
    const chave = `${item.content_version_id}:${destino.channel}`;
    setEnviando(chave);
    try {
      const r = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content_version_id: item.content_version_id,
          channel: destino.channel,
          connection_id: destino.connection_id,
          channel_variant_id: destino.channel_variant_id,
        }),
      });
      const corpo = await r.json().catch(() => ({}));

      setResultado((e) => ({
        ...e,
        [chave]: r.ok
          // Agendado, não publicado: o workflow durável assume daqui.
          ? { ok: true, texto: "Agendado. A publicação acontece em instantes." }
          : { ok: false, texto: MICROCOPY[corpo.reason_code] ?? "Não foi possível agendar a publicação." },
      }));
    } catch {
      setResultado((e) => ({ ...e, [chave]: { ok: false, texto: "Sem conexão. Nada foi agendado." } }));
    } finally {
      setEnviando(null);
    }
  }

  if (itens.length === 0) return null;

  return (
    <ul className="fila">
      {itens.map((item) => (
        <li key={item.content_version_id} className="card">
          <div className="card-head">
            <span className={`chip ${classeDeEstado(item.state)}`}>
              {ROTULO[item.state] ?? item.state}
            </span>
            <strong>{item.title}</strong>
            <span className="muted">versão {item.version}</span>
            {item.publicados.length > 0 && (
              <span className="muted">publicado em {item.publicados.join(", ")}</span>
            )}
          </div>

          <blockquote className="corpo">{item.master_body}</blockquote>

          {item.state === "APPROVED" && podePublicar && item.destinos.length > 0 && (
            <div className="acoes">
              {item.destinos.map((d) => {
                const chave = `${item.content_version_id}:${d.channel}`;
                const res = resultado[chave];
                if (res) return <p key={d.channel} className={res.ok ? "resolvido" : "erro"}>{res.texto}</p>;
                return (
                  <button
                    key={d.channel}
                    className="btn primario"
                    disabled={enviando === chave}
                    onClick={() => publicar(item, d)}
                  >
                    Publicar no {d.channel}
                  </button>
                );
              })}
            </div>
          )}

          {/*
            Aprovado e sem destino significa uma de duas coisas, e as duas são
            do operador resolver: falta variante para o canal, ou falta conexão
            ativa. Dizer isso é mais útil que esconder o botão em silêncio.
          */}
          {item.state === "APPROVED" && item.destinos.length === 0 && (
            <p className="muted">
              Aprovado, mas sem destino: falta variante de canal ou conexão ativa.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
