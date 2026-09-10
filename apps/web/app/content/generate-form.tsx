"use client";

/**
 * Formulário que dispara o AGT-MKT-CONTENT.
 *
 * A marca é escolhida por nome de uma lista já filtrada por Brand Brain
 * ACTIVE — pedir para uma marca sem marca ativa é recusado como
 * BRAND_BRAIN_NOT_ACTIVE lá na frente, e a lista evita o passeio.
 *
 * O que sai daqui é sempre um rascunho (DRAFT): quem decide publicar é a
 * tela de Conteúdo, depois de revisão. Este formulário não agenda nada.
 */
import { useState } from "react";

const CANAIS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "WHATSAPP", "EMAIL", "BLOG"];

const MICROCOPY: Record<string, string> = {
  ACTOR_ROLE_FORBIDDEN: "Seu perfil não tem permissão para gerar conteúdo.",
  BRAND_BRAIN_NOT_ACTIVE: "A marca ainda não foi confirmada. Revise o Brand Brain antes de gerar conteúdo.",
  CLAIM_UNSUPPORTED: "O rascunho afirmava algo sem fonte. Reescreva o briefing sem essa afirmação e tente de novo.",
  AGENT_NOT_ACTIVE: "Este agente ainda não foi liberado para uso.",
  SPEND_LIMIT_EXCEEDED: "O limite de gasto do mês foi atingido.",
};

export function GenerateContentForm({ marcas }: { marcas: { brand_id: string; brand_name: string }[] }) {
  const [brand_name, setBrandName] = useState(marcas[0]?.brand_name ?? "");
  const [objective, setObjective] = useState("");
  const [channel, setChannel] = useState("");
  const [briefing, setBriefing] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setResultado(null);
    try {
      const r = await fetch("/api/content/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand_name, objective, channel, briefing }),
      });
      const corpo = await r.json().catch(() => ({}));

      if (r.ok && corpo.respondability === "EXECUTABLE" && !corpo.reason_code) {
        setResultado({
          ok: true,
          texto: corpo.message ?? "Rascunho criado. Veja abaixo, entre os conteúdos do workspace.",
        });
        setBriefing("");
      } else if (corpo.respondability === "CLARIFICATION_REQUIRED") {
        setResultado({
          ok: false,
          texto: corpo.message ?? "Preciso de mais detalhe para gerar este conteúdo. Ajuste o briefing e tente de novo.",
        });
      } else {
        setResultado({
          ok: false,
          texto: MICROCOPY[corpo.reason_code] ?? "Não consegui gerar o conteúdo agora. Tente de novo.",
        });
      }
    } catch {
      setResultado({ ok: false, texto: "Sem conexão. Nada foi gerado." });
    } finally {
      setEnviando(false);
    }
  }

  if (marcas.length === 0) {
    return (
      <p className="muted">
        Nenhuma marca com Brand Brain ativo. Confirme uma marca em Brand Brain antes de gerar conteúdo.
      </p>
    );
  }

  return (
    <form className="card gerar-form" onSubmit={gerar}>
      <h2 className="gerar-form-titulo">Gerar conteúdo</h2>
      <p className="muted">
        O AGT-MKT-CONTENT escreve um rascunho a partir do briefing, alinhado ao Brand Brain
        ativo da marca. Você revisa antes de aprovar.
      </p>

      <label>
        Marca
        <select value={brand_name} onChange={(e) => setBrandName(e.target.value)}>
          {marcas.map((m) => (
            <option key={m.brand_id} value={m.brand_name}>{m.brand_name}</option>
          ))}
        </select>
      </label>

      <label>
        Objetivo
        <input
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="ex: divulgar a campanha de seguro auto do mês"
        />
      </label>

      <label>
        Canal (opcional)
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">deixar em aberto</option>
          {CANAIS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label>
        Briefing
        <textarea
          value={briefing}
          onChange={(e) => setBriefing(e.target.value)}
          rows={4}
          placeholder="do que este conteúdo deve falar, e o que não afirmar"
        />
      </label>

      <button className="btn primario" type="submit" disabled={enviando}>
        {enviando ? "Gerando…" : "Gerar rascunho"}
      </button>

      {resultado && (
        <p className={resultado.ok ? "resolvido" : "erro"}>{resultado.texto}</p>
      )}
    </form>
  );
}
