"use client";

/**
 * O formulário e o resultado.
 *
 * O cliente não decide nada: manda o pedido e mostra o que o servidor
 * respondeu — inclusive quando a resposta é uma recusa. Um agente que recusa
 * com motivo é o comportamento desenhado, não uma falha a esconder.
 */
import { useState } from "react";
import Link from "next/link";
import messages from "@/messages/reason-codes.pt-BR.json";

type Resposta = {
  trace_id?: string;
  respondability?: string;
  message?: string;
  next_step?: string;
  autonomy_mode?: string | null;
  reason_codes?: string[];
  reason_code?: string;
};

/** Como cada estado de respondability se apresenta a quem pediu. */
const ESTADO: Record<string, { rotulo: string; classe: string }> = {
  EXECUTABLE: { rotulo: "Pronto", classe: "state-approved" },
  CLARIFICATION_REQUIRED: { rotulo: "Falta informação", classe: "state-human-review" },
  APPROVAL_REQUIRED: { rotulo: "Precisa de aprovação", classe: "state-human-review" },
  HANDOFF_HUMAN: { rotulo: "Passou para uma pessoa", classe: "state-human-review" },
  POLICY_BLOCKED: { rotulo: "Bloqueado pela política", classe: "state-blocked" },
  QUALITY_BLOCKED: { rotulo: "Bloqueado pela revisão", classe: "state-blocked" },
  UNSUPPORTED: { rotulo: "Fora do que este agente faz", classe: "state-rejected" },
  TEMPORARILY_UNAVAILABLE: { rotulo: "Indisponível agora", classe: "state-temporarily-unavailable" },
};

const microcopy = (c: string) => (messages as Record<string, string>)[c] ?? c;

export function CriarConteudo({ podeUsar, interno }: { podeUsar: boolean; interno: boolean }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [r, setR] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function pedir(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setR(null);
    setErro(null);
    try {
      const resposta = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Nada de tenant no corpo: quem o define é a sessão, no servidor. Se
        // esta tela mandasse org_id ou workspace_id, o loop recusaria com
        // TENANT_SCOPE_VIOLATION — e estaria certo.
        body: JSON.stringify({ agent_id: "AGT-MKT-CONTENT", text: texto, internal: interno }),
      });
      const corpo: Resposta = await resposta.json();
      // Recusa com reason code é resposta, não erro de rede: ela vai para a
      // mesma caixa que o sucesso, com o motivo em português.
      setR(corpo);
    } catch {
      setErro("Sem conexão. Nada foi criado.");
    } finally {
      setEnviando(false);
    }
  }

  const estado = r?.respondability ? ESTADO[r.respondability] : null;
  const motivos = r?.reason_codes?.length ? r.reason_codes : r?.reason_code ? [r.reason_code] : [];

  return (
    <>
      <form className="login-form" onSubmit={pedir}>
        <label htmlFor="pedido">O que você quer publicar?</label>
        <textarea
          id="pedido"
          className="comentario"
          rows={4}
          value={texto}
          placeholder="Ex.: um post para o Instagram sobre a cobertura de enchente da apólice residencial"
          onChange={(e) => setTexto(e.target.value)}
          disabled={!podeUsar || enviando}
        />
        <button className="btn primario" disabled={!podeUsar || enviando || texto.trim().length === 0}>
          {enviando ? "O agente está trabalhando…" : "Pedir o rascunho"}
        </button>
      </form>

      {erro && <p className="erro">{erro}</p>}

      {r && (
        <section className="card resultado-agente">
          <div className="card-head">
            {estado && <span className={`chip ${estado.classe}`}>{estado.rotulo}</span>}
            {r.autonomy_mode && <span className="muted">modo {r.autonomy_mode.toLowerCase()}</span>}
          </div>

          {r.message && <blockquote className="corpo">{r.message}</blockquote>}
          {r.next_step && <p><strong>Próximo passo:</strong> {r.next_step}</p>}

          {motivos.length > 0 && (
            <ul className="motivos">
              {motivos.map((c) => <li key={c}>{microcopy(c)}</li>)}
            </ul>
          )}

          {/*
            O trace é o que separa "a IA respondeu" de "a IA respondeu e dá
            para conferir". Ele aparece inclusive nas recusas: entender por que
            algo não saiu é tão auditável quanto ver o que saiu.
          */}
          {r.trace_id && (
            <p>
              <Link href={`/traces/${encodeURIComponent(r.trace_id)}`}>
                Ver o passo a passo desta execução
              </Link>
            </p>
          )}

          <p><Link href="/content">Ver o conteúdo do workspace</Link></p>
        </section>
      )}
    </>
  );
}
