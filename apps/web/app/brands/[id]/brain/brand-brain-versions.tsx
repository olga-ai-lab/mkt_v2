"use client";

/**
 * As versoes de Brand Brain, e o botao que faz uma delas valer.
 *
 * O cliente nao decide nada: manda o pedido e mostra o que o servidor
 * respondeu — inclusive o 409 de "ja ativada em outra aba", que e estado
 * legitimo e nao erro, e as lacunas que voltam junto do sucesso.
 */
import { useState } from "react";

type Versao = {
  id: string;
  version: number;
  status: string;
  origem: string;
  created_at: string;
  activated_at: string | null;
  identity: Record<string, unknown>;
  tone: Record<string, unknown>;
  claims_allowed: string[];
  prohibitions: string[];
  disclaimers: string[];
  source_refs: { kind?: string; locator?: string; retrieved_at?: string }[];
  gaps: string[];
};

const ROTULO: Record<string, string> = {
  CANDIDATE: "Candidata", ACTIVE: "Ativa", DEPRECATED: "Substituída",
  BLOCKED: "Bloqueada", DRAFT: "Rascunho",
};

/*
 * O nome do campo, dito para quem opera e não para quem programa.
 *
 * Fica num arquivo de mensagens, e não neste componente, pelo mesmo motivo dos
 * reason codes: há teste conferindo que todo campo que lacunasDe() sabe
 * apontar tem texto aqui. Sem isso, o dia em que alguém acrescentar uma quinta
 * lacuna a tela mostraria o nome cru da coluna.
 */
import lacunas from "@/messages/brand-gaps.pt-BR.json";

const LACUNA: Record<string, string> = lacunas;

const texto = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

export function BrandBrainVersions(
  { brandId, itens, podeAtivar }: { brandId: string; itens: Versao[]; podeAtivar: boolean },
) {
  const [estado, setEstado] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [enviando, setEnviando] = useState<string | null>(null);

  async function ativar(versionId: string) {
    setEnviando(versionId);
    try {
      const r = await fetch(`/api/brands/${brandId}/brain/${versionId}/activate`, { method: "POST" });
      const corpo = await r.json().catch(() => ({}));

      if (r.ok) {
        const lacunas = (corpo.gaps ?? []).map((g: string) => LACUNA[g] ?? g);
        setEstado((e) => ({
          ...e,
          [versionId]: {
            ok: true,
            texto: [
              `Versão ${corpo.version} ativada.`,
              corpo.replaced_version ? `A versão ${corpo.replaced_version} passou a ser a anterior.` : "",
              lacunas.length ? `Falta preencher: ${lacunas.join("; ")}.` : "",
            ].filter(Boolean).join(" "),
          },
        }));
        return;
      }

      if (corpo.already_active) {
        setEstado((e) => ({
          ...e,
          [versionId]: { ok: true, texto: "Já estava ativa — outra aba ativou antes. Recarregue para ver o estado atual." },
        }));
        return;
      }

      setEstado((e) => ({
        ...e,
        [versionId]: {
          ok: false,
          texto: corpo.reason_code === "ACTOR_ROLE_FORBIDDEN"
            ? "Ativar a marca é ato de dono do workspace."
            : "Não foi possível ativar esta versão.",
        },
      }));
    } catch {
      setEstado((e) => ({ ...e, [versionId]: { ok: false, texto: "Sem conexão. Nada foi ativado." } }));
    } finally {
      setEnviando(null);
    }
  }

  if (itens.length === 0) return null;

  return (
    <ul className="fila">
      {itens.map((v) => {
        const resultado = estado[v.id];
        return (
          <li key={v.id} className="card">
            <div className="card-head">
              <span className={`chip state-${v.status.toLowerCase()}`}>{ROTULO[v.status] ?? v.status}</span>
              <span className="muted">versão {v.version}</span>
              <span className="muted">{v.origem === "agent" ? "proposta pelo agente" : "criada por pessoa"}</span>
            </div>

            {texto(v.identity && (v.identity as any).summary) && (
              <p className="corpo">{texto((v.identity as any).summary)}</p>
            )}

            <dl className="brain">
              <dt>Pode afirmar</dt>
              <dd>{v.claims_allowed.length ? v.claims_allowed.map(texto).join(" · ") : "—"}</dd>
              <dt>Não pode dizer</dt>
              <dd>{v.prohibitions.length ? v.prohibitions.map(texto).join(" · ") : "—"}</dd>
              <dt>Disclaimers</dt>
              <dd>{v.disclaimers.length ? v.disclaimers.map(texto).join(" · ") : "—"}</dd>
              <dt>Fonte</dt>
              <dd>
                {v.source_refs.length
                  ? v.source_refs.map((s) => s.locator).filter(Boolean).join(" · ")
                  : "—"}
              </dd>
            </dl>

            {/*
              As lacunas aparecem ANTES de ativar, e não só depois: quem decide
              precisa saber o que está assumindo enquanto ainda pode voltar.
            */}
            {v.gaps.length > 0 && v.status !== "DEPRECATED" && (
              <ul className="motivos">
                {v.gaps.map((g) => <li key={g}>{LACUNA[g] ?? g}</li>)}
              </ul>
            )}

            {resultado ? (
              <p className={resultado.ok ? "resolvido" : "erro"}>{resultado.texto}</p>
            ) : v.status === "ACTIVE" ? (
              <p className="muted">É esta a marca que o agente usa hoje.</p>
            ) : v.status === "BLOCKED" ? (
              <p className="muted">Bloqueada. Quem bloqueou precisa desfazer antes.</p>
            ) : (
              <div className="acoes">
                <button
                  className="btn primario"
                  disabled={!podeAtivar || enviando === v.id}
                  onClick={() => ativar(v.id)}
                >
                  {v.status === "DEPRECATED" ? "Voltar para esta versão" : "Ativar esta versão"}
                </button>
                {!podeAtivar && <span className="muted">Ativar a marca é ato de dono do workspace.</span>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
