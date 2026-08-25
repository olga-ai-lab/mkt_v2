"use client";

/**
 * Fila de decisao.
 *
 * O cliente nao decide nada sobre validade: ele manda a decisao e mostra o que
 * o servidor respondeu. Inclusive o 409 de "ja decidido por outra aba", que e
 * estado legitimo e nao erro.
 */
import { useState } from "react";

type Item = {
  approval_id: string;
  subject_version: number;
  created_at: string;
  motivos: { code: string; texto: string }[];
  content: {
    id: string; version: number; state: string;
    risk_tier: string; master_body: string;
  } | null;
};

const classeDeEstado = (s: string) => `state-${s.toLowerCase().replace(/_/g, "-")}`;

const ROTULO: Record<string, string> = {
  DRAFT: "Rascunho", AI_REVIEW: "Revisão da IA", HUMAN_REVIEW: "Revisão humana",
  COMPLIANCE_REVIEW: "Revisão de compliance", APPROVED: "Aprovado",
  SCHEDULED: "Agendado", PUBLISHING: "Publicando", PUBLISHED: "Publicado",
  REJECTED: "Recusado", FAILED: "Falhou", CANCELLED: "Cancelado",
};

export function ApprovalQueue({ itens }: { itens: Item[] }) {
  const [estado, setEstado] = useState<Record<string, { status: string; texto: string }>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [comentarios, setComentarios] = useState<Record<string, string>>({});

  async function decidir(id: string, decision: "APPROVED" | "REJECTED") {
    setEnviando(id);
    try {
      const r = await fetch(`/api/approvals/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision, comment: comentarios[id] ?? null }),
      });
      const corpo = await r.json().catch(() => ({}));

      if (r.ok) {
        setEstado((e) => ({
          ...e,
          [id]: {
            status: corpo.decision,
            texto: corpo.decision === "APPROVED" ? "Aprovado." : "Recusado.",
          },
        }));
        return;
      }

      // 409 com already_decided: alguem decidiu antes. Mostrar o que vale.
      if (corpo.already_decided) {
        setEstado((e) => ({
          ...e,
          [id]: { status: corpo.decision, texto: `Já decidido em outra aba: ${ROTULO[corpo.decision] ?? corpo.decision}.` },
        }));
        return;
      }

      // Nunca a mensagem tecnica: sempre a microcopy do reason code.
      setEstado((e) => ({
        ...e,
        [id]: { status: "ERRO", texto: corpo.message_key ? textoDoErro(corpo) : "Não foi possível registrar sua decisão." },
      }));
    } catch {
      setEstado((e) => ({ ...e, [id]: { status: "ERRO", texto: "Sem conexão. Sua decisão não foi registrada." } }));
    } finally {
      setEnviando(null);
    }
  }

  if (itens.length === 0) return null;

  return (
    <ul className="fila">
      {itens.map((item) => {
        const decidido = estado[item.approval_id];
        return (
          <li key={item.approval_id} className="card">
            <div className="card-head">
              <span className={`chip ${classeDeEstado(item.content?.state ?? "DRAFT")}`}>
                {ROTULO[item.content?.state ?? "DRAFT"] ?? item.content?.state}
              </span>
              <span className="muted">versão {item.subject_version}</span>
              {item.content?.risk_tier ? (
                <span className="muted">risco {item.content.risk_tier.toLowerCase()}</span>
              ) : null}
            </div>

            {item.motivos.length > 0 && (
              <ul className="motivos">
                {item.motivos.map((m) => <li key={m.code}>{m.texto}</li>)}
              </ul>
            )}

            <blockquote className="corpo">{item.content?.master_body}</blockquote>

            {decidido ? (
              <p className={decidido.status === "ERRO" ? "erro" : "resolvido"}>{decidido.texto}</p>
            ) : (
              <div className="acoes">
                <label className="sr-only" htmlFor={`c-${item.approval_id}`}>Comentário</label>
                <input
                  id={`c-${item.approval_id}`}
                  className="comentario"
                  placeholder="Comentário (obrigatório para recusar)"
                  value={comentarios[item.approval_id] ?? ""}
                  onChange={(e) => setComentarios((c) => ({ ...c, [item.approval_id]: e.target.value }))}
                />
                <button
                  className="btn primario"
                  disabled={enviando === item.approval_id}
                  onClick={() => decidir(item.approval_id, "APPROVED")}
                >
                  Aprovar esta versão
                </button>
                <button
                  className="btn neutro"
                  // Recusa sem motivo escrito nao ajuda quem vai corrigir.
                  disabled={enviando === item.approval_id || !(comentarios[item.approval_id] ?? "").trim()}
                  onClick={() => decidir(item.approval_id, "REJECTED")}
                >
                  Recusar
                </button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function textoDoErro(corpo: { message_key?: string; reason_code?: string }) {
  if (corpo.reason_code === "CONTENT_NOT_APPROVED") {
    return "Este item mudou desde que a tela carregou. Recarregue para ver o estado atual.";
  }
  return "Não foi possível registrar sua decisão.";
}
