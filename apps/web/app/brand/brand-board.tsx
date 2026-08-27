"use client";

/**
 * O quadro de marcas.
 *
 * O cliente não decide nada sobre validade: manda a promoção e mostra o que o
 * servidor respondeu. O 409 de "esta versão não é mais CANDIDATE" é estado
 * legítimo — outra aba promoveu antes — e não erro.
 */
import { useState } from "react";

type Versao = {
  version_id: string;
  version: number;
  status: string;
  identity: any;
  tone: any;
  claims_allowed: any[];
  prohibitions: any[];
  disclaimers: any[];
  source_refs: any[];
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

/** Texto de um item que pode ser string ou objeto — o jsonb aceita os dois. */
const comoTexto = (i: any) =>
  typeof i === "string" ? i : i?.texto ?? i?.text ?? JSON.stringify(i);

function Lista({ titulo, itens }: { titulo: string; itens: any[] }) {
  return (
    <div className="bb-campo">
      <h4>
        {titulo} <span className="muted">({itens.length})</span>
      </h4>
      {itens.length === 0 ? (
        <p className="muted">— nada declarado</p>
      ) : (
        <ul>
          {itens.map((i, n) => (
            <li key={n}>
              {comoTexto(i)}
              {i?.citacao && <blockquote className="bb-citacao">“{i.citacao}”</blockquote>}
            </li>
          ))}
        </ul>
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
        {v.identity?.publico && <p className="muted">Público: {v.identity.publico}</p>}
      </div>

      <div className="bb-campo">
        <h4>Tom de voz</h4>
        <p>{v.tone?.descricao ?? "—"}</p>
      </div>

      <Lista titulo="Claims permitidos" itens={v.claims_allowed} />
      <Lista titulo="Proibições" itens={v.prohibitions} />
      <Lista titulo="Disclaimers" itens={v.disclaimers} />

      {v.source_refs.length > 0 && (
        <div className="bb-campo">
          <h4>Procedência</h4>
          <ul>
            {v.source_refs.map((s: any, n: number) => (
              <li key={n} className="muted">
                {s.url ?? s.locator ?? "fonte"}{" "}
                {s.hash && <code className="bb-hash">{String(s.hash).slice(0, 12)}</code>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function BrandBoard({
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
      const r = await fetch("/api/brand/promote", {
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
                  ? "Só o dono do workspace promove uma versão do Brand Brain."
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
              <span className="muted">
                sem site cadastrado — o agente não tem o que ler
              </span>
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
                  Nenhuma versão ativa. Enquanto não houver, criar conteúdo para
                  esta marca é recusado com BRAND_BRAIN_NOT_ACTIVE.
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
                  const resultado = estado[v.version_id];
                  return (
                  <div key={v.version_id} className="bb-candidata">
                    <p className="muted">
                      Versão {v.version} · proposta{" "}
                      {v.criado_por_tipo === "agent" ? "pelo agente" : "por uma pessoa"} em{" "}
                      {new Date(v.created_at).toLocaleDateString("pt-BR")}
                    </p>
                    <Versao v={v} />

                    {resultado ? (
                      <p className={resultado.status === "ok" ? "resolvido" : "erro"}>
                        {resultado.texto}
                      </p>
                    ) : podePromover ? (
                      <button
                        className="btn primario"
                        disabled={enviando === v.version_id}
                        onClick={() => promover(m.brand_id, v.version_id, v.version)}
                      >
                        {enviando === v.version_id
                          ? "Promovendo…"
                          : m.ativa
                            ? `Promover, substituindo a versão ${m.ativa.version}`
                            : "Promover para ACTIVE"}
                      </button>
                    ) : (
                      <p className="muted">
                        Só o dono do workspace pode promover uma versão.
                      </p>
                    )}
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
