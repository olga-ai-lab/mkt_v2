"use client";

/**
 * O formulário e o resultado, item a item.
 *
 * O cliente não decide nada sobre o freio: quem para o lote é o servidor. Aqui
 * só se mostra o que ele respondeu — inclusive quais itens nem chegaram a ser
 * tentados, que é a informação que evita a pessoa reescrever briefs bons.
 */
import { useState } from "react";
import Link from "next/link";
import messages from "@/messages/reason-codes.pt-BR.json";

type Item = {
  indice: number;
  brief: string;
  estado: "EXECUTADO" | "FALHOU" | "NAO_TENTADO";
  trace_id?: string;
  respondability?: string | null;
  reason_codes?: string[];
};

type Resposta = {
  itens?: Item[];
  interrompido?: string | null;
  reason_code?: string;
  max_por_lote?: number;
};

const microcopy = (c: string) => (messages as Record<string, string>)[c] ?? c;

const ESTADO: Record<string, { rotulo: string; classe: string }> = {
  EXECUTADO: { rotulo: "rodou", classe: "state-approved" },
  FALHOU: { rotulo: "falhou", classe: "state-failed" },
  NAO_TENTADO: { rotulo: "não tentado", classe: "state-draft" },
};

export function GerarEmLote(
  { podeUsar, interno, max }: { podeUsar: boolean; interno: boolean; max: number },
) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [r, setR] = useState<Resposta | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const briefs = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const demais = briefs.length > max;

  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setR(null);
    setErro(null);
    try {
      const resposta = await fetch("/api/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ briefs, internal: interno }),
      });
      setR(await resposta.json());
    } catch {
      setErro("Sem conexão. Nada foi gerado.");
    } finally {
      setEnviando(false);
    }
  }

  const naoTentados = r?.itens?.filter((i) => i.estado === "NAO_TENTADO").length ?? 0;

  return (
    <>
      <form className="login-form" onSubmit={gerar}>
        <label htmlFor="briefs">Um brief por linha</label>
        <textarea
          id="briefs"
          className="comentario"
          rows={8}
          value={texto}
          placeholder={"post sobre cobertura de enchente\npost sobre seguro de bicicleta\npost sobre assistência 24h"}
          onChange={(e) => setTexto(e.target.value)}
          disabled={!podeUsar || enviando}
        />
        <p className="muted">
          {briefs.length === 0
            ? "Nenhum brief ainda."
            : `${briefs.length} ${briefs.length === 1 ? "brief" : "briefs"}${demais ? ` — acima do teto de ${max}` : ""}.`}
        </p>
        <button
          className="btn primario"
          disabled={!podeUsar || enviando || briefs.length === 0 || demais}
        >
          {enviando ? `Gerando ${briefs.length}…` : `Gerar ${briefs.length || ""}`.trim()}
        </button>
      </form>

      {erro && <p className="erro">{erro}</p>}

      {r?.reason_code && !r.itens && (
        <p className="erro">{microcopy(r.reason_code)}</p>
      )}

      {r?.interrompido && (
        // O aviso mais importante da tela: diz que o lote parou de propósito e
        // que os itens restantes não foram gastos.
        <p className="callout aviso">
          O lote parou: {microcopy(r.interrompido)}
          {naoTentados > 0 && (
            <> {naoTentados} {naoTentados === 1 ? "item não foi tentado" : "itens não foram tentados"} e {naoTentados === 1 ? "continua" : "continuam"} abaixo, para reenviar.</>
          )}
        </p>
      )}

      {r?.itens && (
        <ul className="fila">
          {r.itens.map((item) => {
            // Estado desconhecido nao pode quebrar a tela: se o servidor
            // ganhar um quarto valor, ele aparece cru em vez de sumir.
            const e = ESTADO[item.estado] ?? { rotulo: item.estado, classe: "state-draft" };
            return (
              <li key={item.indice} className="card">
                <div className="card-head">
                  <span className={`chip ${e.classe}`}>{e.rotulo}</span>
                  {item.respondability && <span className="muted">{item.respondability}</span>}
                  {item.trace_id && (
                    <Link href={`/traces/${encodeURIComponent(item.trace_id)}`}>ver o trace</Link>
                  )}
                </div>
                <blockquote className="corpo">{item.brief}</blockquote>
                {item.reason_codes && item.reason_codes.length > 0 && (
                  <ul className="motivos">
                    {item.reason_codes.map((c) => <li key={c}>{microcopy(c)}</li>)}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {r?.itens && <p><Link href="/content">Ver o conteúdo do workspace</Link></p>}
    </>
  );
}
