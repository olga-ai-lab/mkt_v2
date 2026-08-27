"use client";

/**
 * As versoes de Brand Brain: o que cada uma permite, o que falta nela, e os
 * dois atos que uma pessoa pode praticar sobre ela.
 *
 * Editar NAO altera a versao aberta: cria a proxima, candidata. Por isso o
 * botao diz "salvar como nova candidata" — o nome do botao e a regra, e um
 * "salvar" seco faria parecer que a linha muda de lugar.
 *
 * O cliente nao decide nada: manda o pedido e mostra o que o servidor
 * respondeu — inclusive o 409 de "ja ativada em outra aba", que e estado
 * legitimo e nao erro, e as lacunas que voltam junto do sucesso.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

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

const texto = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

/** Lista para textarea e de volta: um item por linha, vazios fora. */
const paraLinhas = (lista: string[]) => (lista ?? []).map(texto).join("\n");
const paraLista = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

const mesmaLista = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

type Rascunho = {
  summary: string; voice: string;
  claims_allowed: string; prohibitions: string; disclaimers: string;
};

const rascunhoDe = (v: Versao): Rascunho => ({
  summary: texto((v.identity as any)?.summary),
  voice: texto((v.tone as any)?.voice),
  claims_allowed: paraLinhas(v.claims_allowed),
  prohibitions: paraLinhas(v.prohibitions),
  disclaimers: paraLinhas(v.disclaimers),
});

/**
 * Só o que mudou entra no patch.
 *
 * O contrato exige ao menos um campo, e isso não é formalidade: salvar uma
 * versão idêntica à anterior só acrescenta ruído à lista de quem decide qual
 * ativar.
 */
function patchDe(v: Versao, r: Rascunho) {
  const patch: Record<string, unknown> = {};

  const identity = { ...(v.identity as any) };
  if (r.summary.trim() !== texto(identity.summary)) {
    patch.identity = { ...identity, summary: r.summary.trim() || undefined };
    if (!r.summary.trim()) delete (patch.identity as any).summary;
  }

  const tone = { ...(v.tone as any) };
  if (r.voice.trim() !== texto(tone.voice)) {
    patch.tone = { ...tone, voice: r.voice.trim() || undefined };
    if (!r.voice.trim()) delete (patch.tone as any).voice;
  }

  for (const campo of ["claims_allowed", "prohibitions", "disclaimers"] as const) {
    const nova = paraLista(r[campo]);
    if (!mesmaLista(nova, (v[campo] ?? []).map(texto))) patch[campo] = nova;
  }

  return patch;
}

export function BrandBrainVersions(
  { brandId, itens, podeAtivar, podeEditar }:
  { brandId: string; itens: Versao[]; podeAtivar: boolean; podeEditar: boolean },
) {
  const router = useRouter();
  const [estado, setEstado] = useState<Record<string, { ok: boolean; texto: string }>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);

  function abrirEdicao(v: Versao) {
    setEditando(v.id);
    setRascunho(rascunhoDe(v));
    setEstado((e) => ({ ...e, [v.id]: undefined as never }));
  }

  async function ativar(versionId: string) {
    setEnviando(versionId);
    try {
      const r = await fetch(`/api/brands/${brandId}/brain/${versionId}/activate`, { method: "POST" });
      const corpo = await r.json().catch(() => ({}));

      if (r.ok) {
        const faltando = (corpo.gaps ?? []).map((g: string) => LACUNA[g] ?? g);
        setEstado((e) => ({
          ...e,
          [versionId]: {
            ok: true,
            texto: [
              `Versão ${corpo.version} ativada.`,
              corpo.replaced_version ? `A versão ${corpo.replaced_version} passou a ser a anterior.` : "",
              faltando.length ? `Falta preencher: ${faltando.join("; ")}.` : "",
            ].filter(Boolean).join(" "),
          },
        }));
        router.refresh();
        return;
      }

      if (corpo.already_active) {
        setEstado((e) => ({
          ...e,
          [versionId]: { ok: true, texto: "Já estava ativa — outra aba ativou antes." },
        }));
        router.refresh();
        return;
      }

      setEstado((e) => ({ ...e, [versionId]: { ok: false, texto: erroDe(corpo, "ativar") } }));
    } catch {
      setEstado((e) => ({ ...e, [versionId]: { ok: false, texto: "Sem conexão. Nada foi ativado." } }));
    } finally {
      setEnviando(null);
    }
  }

  async function salvar(v: Versao) {
    if (!rascunho) return;
    const patch = patchDe(v, rascunho);

    if (Object.keys(patch).length === 0) {
      setEstado((e) => ({
        ...e,
        [v.id]: { ok: false, texto: "Nada mudou — não criei uma versão igual à anterior." },
      }));
      return;
    }

    setEnviando(v.id);
    try {
      const r = await fetch(`/api/brands/${brandId}/brain/versions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from_version_id: v.id, patch }),
      });
      const corpo = await r.json().catch(() => ({}));

      if (r.ok) {
        const faltando = (corpo.gaps ?? []).map((g: string) => LACUNA[g] ?? g);
        setEstado((e) => ({
          ...e,
          [v.id]: {
            ok: true,
            texto: [
              `Versão ${corpo.version} criada como candidata, a partir da ${corpo.from_version}.`,
              faltando.length ? `Ainda falta: ${faltando.join("; ")}.` : "Nada faltando nela.",
            ].join(" "),
          },
        }));
        setEditando(null);
        setRascunho(null);
        router.refresh();
        return;
      }

      setEstado((e) => ({ ...e, [v.id]: { ok: false, texto: erroDe(corpo, "salvar") } }));
    } catch {
      setEstado((e) => ({ ...e, [v.id]: { ok: false, texto: "Sem conexão. Nada foi salvo." } }));
    } finally {
      setEnviando(null);
    }
  }

  if (itens.length === 0) return null;

  return (
    <ul className="fila">
      {itens.map((v) => {
        const resultado = estado[v.id];
        const emEdicao = editando === v.id && rascunho;
        return (
          <li key={v.id} className="card">
            <div className="card-head">
              <span className={`chip state-${v.status.toLowerCase()}`}>{ROTULO[v.status] ?? v.status}</span>
              <span className="muted">versão {v.version}</span>
              <span className="muted">{v.origem === "agent" ? "proposta pelo agente" : "escrita por pessoa"}</span>
            </div>

            {emEdicao ? (
              <div className="brain-edit">
                <label htmlFor={`s-${v.id}`}>Quem é a marca</label>
                <textarea
                  id={`s-${v.id}`} rows={3}
                  value={rascunho!.summary}
                  onChange={(e) => setRascunho({ ...rascunho!, summary: e.target.value })}
                />

                <label htmlFor={`t-${v.id}`}>Como ela fala</label>
                <textarea
                  id={`t-${v.id}`} rows={2}
                  value={rascunho!.voice}
                  onChange={(e) => setRascunho({ ...rascunho!, voice: e.target.value })}
                />

                <label htmlFor={`c-${v.id}`}>Pode afirmar — um por linha</label>
                <textarea
                  id={`c-${v.id}`} rows={4}
                  value={rascunho!.claims_allowed}
                  onChange={(e) => setRascunho({ ...rascunho!, claims_allowed: e.target.value })}
                />

                <label htmlFor={`p-${v.id}`}>Não pode dizer — um por linha</label>
                {/*
                  O campo que só existe aqui: a extração nunca o preenche, porque
                  uma página diz o que a marca fala e não o que ela se recusa a
                  falar. Enquanto esta lista estiver vazia, o compliance confere
                  lista vazia.
                */}
                <textarea
                  id={`p-${v.id}`} rows={4}
                  placeholder="cobertura total&#10;garantido&#10;sem carência"
                  value={rascunho!.prohibitions}
                  onChange={(e) => setRascunho({ ...rascunho!, prohibitions: e.target.value })}
                />

                <label htmlFor={`d-${v.id}`}>Disclaimers exigidos — um por linha</label>
                <textarea
                  id={`d-${v.id}`} rows={3}
                  value={rascunho!.disclaimers}
                  onChange={(e) => setRascunho({ ...rascunho!, disclaimers: e.target.value })}
                />

                <p className="muted">
                  A fonte desta versão é herdada e não muda ao editar: ela diz de onde
                  o texto veio, não quem o revisou.
                </p>
              </div>
            ) : (
              <>
                {texto((v.identity as any)?.summary) && (
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
              </>
            )}

            {/*
              As lacunas aparecem ANTES de agir, e não só depois: quem decide
              precisa saber o que está assumindo enquanto ainda pode voltar.
            */}
            {v.gaps.length > 0 && v.status !== "DEPRECATED" && !emEdicao && (
              <ul className="motivos">
                {v.gaps.map((g) => <li key={g}>{LACUNA[g] ?? g}</li>)}
              </ul>
            )}

            {resultado && <p className={resultado.ok ? "resolvido" : "erro"}>{resultado.texto}</p>}

            {emEdicao ? (
              <div className="acoes">
                <button className="btn primario" disabled={enviando === v.id} onClick={() => salvar(v)}>
                  Salvar como nova candidata
                </button>
                <button
                  className="btn neutro"
                  disabled={enviando === v.id}
                  onClick={() => { setEditando(null); setRascunho(null); }}
                >
                  Cancelar
                </button>
              </div>
            ) : v.status === "BLOCKED" ? (
              <p className="muted">Bloqueada. Quem bloqueou precisa desfazer antes.</p>
            ) : (
              <div className="acoes">
                {v.status === "ACTIVE" ? (
                  <span className="muted">É esta a marca que o agente usa hoje.</span>
                ) : (
                  <button
                    className="btn primario"
                    disabled={!podeAtivar || enviando === v.id}
                    onClick={() => ativar(v.id)}
                  >
                    {v.status === "DEPRECATED" ? "Voltar para esta versão" : "Ativar esta versão"}
                  </button>
                )}
                {podeEditar && (
                  <button className="btn neutro" disabled={enviando === v.id} onClick={() => abrirEdicao(v)}>
                    {v.status === "ACTIVE" ? "Escrever a próxima a partir desta" : "Revisar e editar"}
                  </button>
                )}
                {!podeAtivar && v.status !== "ACTIVE" && (
                  <span className="muted">Ativar a marca é ato de dono do workspace.</span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function erroDe(corpo: { reason_code?: string }, acao: "ativar" | "salvar") {
  if (corpo.reason_code === "ACTOR_ROLE_FORBIDDEN") {
    return acao === "ativar"
      ? "Ativar a marca é ato de dono do workspace."
      : "Editar a marca exige perfil de marketing ou de dono.";
  }
  if (corpo.reason_code === "SCHEMA_VALIDATION_FAILED") {
    return "Algum campo ficou fora do formato aceito. Confira os tamanhos e tente de novo.";
  }
  if (corpo.reason_code === "UNSUPPORTED_VALUE") {
    return "Esta versão mudou desde que a tela carregou. Recarregue para ver o estado atual.";
  }
  return acao === "ativar" ? "Não foi possível ativar esta versão." : "Não foi possível salvar.";
}
