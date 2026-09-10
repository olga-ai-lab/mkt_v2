"use client";

/**
 * O quadro de perfis.
 *
 * O cliente não decide nada sobre validade: manda a promoção e mostra o que o
 * servidor respondeu. O 409 de "esta versão não é mais CANDIDATE" é estado
 * legítimo — outra aba decidiu antes — e não erro.
 */
import { useState } from "react";

type Versao = {
  version_id: string;
  version: number;
  status: string;
  company_type: string;
  identity: any;
  tone_axes: Record<string, number>;
  tone_observed: Record<string, number>;
  voice_examples: any[];
  prohibitions: any[];
  disclaimers: any[];
  gaps: any[];
  products: any[];
  audiences: any[];
  carriers: any[];
  sources: any[];
  created_at: string;
  criado_por_tipo: string;
  activated_at: string | null;
  ativado_por: string | null;
};

type Marca = {
  brand_id: string;
  brand_name: string;
  website_url: string | null;
  ativa: Versao | null;
  candidatas: Versao[];
};

const EIXOS = ["formalidade", "tecnicidade", "calor", "humor", "urgencia"] as const;

const comoTexto = (i: any) =>
  typeof i === "string" ? i : i?.texto ?? i?.text ?? JSON.stringify(i);

/**
 * Os eixos de tom, lado a lado.
 *
 * Declarado é o que a empresa diz ter; observado é o que as publicações
 * mostram. Divergir não é erro — é a informação mais útil desta tela, e por
 * isso a diferença aparece marcada em vez de ser escondida numa média.
 */
function Tom({ declarado, observado }: { declarado: Record<string, number>; observado: Record<string, number> }) {
  const temObservado = Object.keys(observado ?? {}).length > 0;
  return (
    <div className="bb-campo">
      <h4>Tom de voz <span className="muted">(1 a 5)</span></h4>
      <ul>
        {EIXOS.filter((e) => declarado?.[e] != null || observado?.[e] != null).map((e) => {
          const d = declarado?.[e];
          const o = observado?.[e];
          const diverge = d != null && o != null && Math.abs(d - o) >= 2;
          return (
            <li key={e}>
              {e}: <strong>{d ?? "—"}</strong>
              {temObservado && (
                <span className={diverge ? "" : "muted"}>
                  {" "}· observado {o ?? "—"}
                  {diverge ? " ← diverge do declarado" : ""}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!temObservado && (
        <p className="muted">
          Sem tom observado: nenhuma publicação foi lida ainda.
        </p>
      )}
    </div>
  );
}

function Versao({ v }: { v: Versao }) {
  return (
    <div className="bb-versao">
      <div className="bb-campo">
        <h4>Identidade</h4>
        <p>
          <strong>{v.identity?.nome ?? "—"}</strong>
          {v.identity?.o_que_faz ? ` — ${v.identity.o_que_faz}` : ""}
        </p>
        <p className="muted">{v.company_type}</p>
      </div>

      <div className="bb-campo">
        <h4>Produtos <span className="muted">({v.products.length})</span></h4>
        {v.products.length === 0 ? (
          <p className="muted">— nenhum produto canônico reconhecido</p>
        ) : (
          <ul>
            {v.products.map((p: any) => (
              <li key={p.product_code}>
                {p.label ?? p.product_code}
                {p.is_focus ? <strong> · foco</strong> : ""}{" "}
                <code className="bb-hash">{p.product_code}</code>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bb-campo">
        <h4>Público <span className="muted">({v.audiences.length})</span></h4>
        {v.audiences.length === 0 ? (
          <p className="muted">— nenhum público declarado</p>
        ) : (
          <ul>
            {v.audiences.map((a: any) => (
              <li key={a.audience_code}>{a.label ?? a.audience_code}</li>
            ))}
          </ul>
        )}
      </div>

      <Tom declarado={v.tone_axes} observado={v.tone_observed} />

      {v.carriers.length > 0 && (
        <div className="bb-campo">
          <h4>Seguradoras <span className="muted">({v.carriers.length})</span></h4>
          <ul>
            {v.carriers.map((c: any) => (
              <li key={c.carrier_name}>
                {c.carrier_name} <span className="muted">· {c.relationship}</span>
                {!c.can_mention && <span className="muted"> · não citar em conteúdo</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* As lacunas vêm antes da procedência de propósito: é o que a pessoa
          precisa ver para decidir, e é o que a entrevista vai preencher. */}
      <div className="bb-campo">
        <h4>O que este perfil não diz <span className="muted">({v.gaps.length})</span></h4>
        {v.gaps.length === 0 ? (
          <p className="muted">— nenhuma lacuna declarada</p>
        ) : (
          <ul>
            {v.gaps.map((g: any, n: number) => (
              <li key={n}>{comoTexto(g)}</li>
            ))}
          </ul>
        )}
      </div>

      {v.sources.length > 0 && (
        <div className="bb-campo">
          <h4>Procedência <span className="muted">({v.sources.length})</span></h4>
          <ul>
            {v.sources.map((s: any, n: number) => (
              <li key={n}>
                <span className="muted">
                  {s.field_path} · {s.source_kind} · {s.confidence}
                </span>
                {s.quote && <blockquote className="bb-citacao">“{s.quote}”</blockquote>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PerfilBoard({
  marcas,
  podePromover,
}: {
  marcas: Marca[];
  podePromover: boolean;
}) {
  const [estado, setEstado] = useState<Record<string, { status: string; texto: string }>>({});
  const [enviando, setEnviando] = useState<string | null>(null);

  async function promover(brand_id: string, version_id: string, version: number) {
    setEnviando(version_id);
    try {
      const r = await fetch("/api/profile/promote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand_id, version_id }),
      });
      const corpo = await r.json().catch(() => ({}));

      if (r.ok) {
        const antes = corpo.substituida
          ? ` A versão ${corpo.substituida.version} foi para DEPRECATED.`
          : "";
        setEstado((e) => ({
          ...e,
          [version_id]: {
            status: "ok",
            texto: `Versão ${version} está ACTIVE.${antes} Recarregue para ver o quadro atualizado.`,
          },
        }));
      } else {
        setEstado((e) => ({
          ...e,
          [version_id]: {
            status: "erro",
            texto:
              corpo.reason_code === "UNSUPPORTED_VALUE"
                ? "Esta versão não está mais candidata — alguém decidiu antes. Recarregue."
                : corpo.reason_code === "ACTOR_ROLE_FORBIDDEN"
                  ? "Só o dono do workspace promove o perfil da empresa."
                  : `Não consegui promover (${corpo.reason_code ?? r.status}).`,
          },
        }));
      }
    } catch {
      setEstado((e) => ({
        ...e,
        [version_id]: { status: "erro", texto: "Falha de rede. Tente de novo." },
      }));
    } finally {
      setEnviando(null);
    }
  }

  if (marcas.length === 0) return null;

  return (
    <div className="bb-lista">
      {marcas.map((m) => (
        <section key={m.brand_id} className="card bb-marca">
          <header className="bb-marca-head">
            <h2>{m.brand_name}</h2>
            {m.website_url ? (
              <span className="muted">{m.website_url}</span>
            ) : (
              <span className="muted">sem site cadastrado — o agente não tem o que ler</span>
            )}
          </header>

          <div className="bb-colunas">
            <div className="bb-coluna">
              <h3>
                Em vigor <span className="chip chip-ativa">ACTIVE</span>
              </h3>
              {m.ativa ? (
                <>
                  <p className="muted">
                    Versão {m.ativa.version}
                    {m.ativa.ativado_por ? ` · promovida por ${m.ativa.ativado_por}` : ""}
                  </p>
                  <Versao v={m.ativa} />
                </>
              ) : (
                <p className="muted">
                  Nenhum perfil ativo. Enquanto não houver, o conteúdo desta marca é
                  escrito sem saber quais produtos ela vende nem para quem.
                </p>
              )}
            </div>

            <div className="bb-coluna">
              <h3>
                Proposta <span className="chip chip-candidata">CANDIDATE</span>
              </h3>
              {m.candidatas.length === 0 ? (
                <p className="muted">Nenhuma proposta esperando decisão.</p>
              ) : (
                m.candidatas.map((v) => {
                  const r = estado[v.version_id];
                  return (
                    <div key={v.version_id} className="bb-candidata">
                      <p className="muted">
                        Versão {v.version} · proposta por{" "}
                        {v.criado_por_tipo === "agent" ? "um agente" : "uma pessoa"}
                      </p>
                      <Versao v={v} />
                      {podePromover ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={enviando === v.version_id || r?.status === "ok"}
                          onClick={() => promover(m.brand_id, v.version_id, v.version)}
                        >
                          {enviando === v.version_id ? "Promovendo…" : "Promover para ACTIVE"}
                        </button>
                      ) : (
                        <p className="muted">
                          Só o dono do workspace promove o perfil da empresa.
                        </p>
                      )}
                      {r && <p className={r.status === "ok" ? "muted" : "erro"}>{r.texto}</p>}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
