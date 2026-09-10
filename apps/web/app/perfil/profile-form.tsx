"use client";

/**
 * O formulario de perfil.
 *
 * O Hub desenha oito etapas; estas sao as que ja tem para onde ir no
 * banco (migration 0012). Preferi um formulario curto e inteiro a um
 * wizard de oito passos em que cinco nao gravam nada — passo que nao
 * persiste e passo que ensina o usuario que preencher nao adianta.
 *
 * Os rotulos falam a lingua de quem preenche; os valores sao os enums do
 * banco. A traducao vive num lugar so, aqui, e do outro lado
 * (prompt-templates.mjs) ha a versao que o prompt consome.
 */
import { useState } from "react";

const ORG_TYPES = [
  { v: "CORRETORA", r: "Corretora" },
  { v: "CORRETOR_AUTONOMO", r: "Corretor autonomo" },
  { v: "ASSESSORIA", r: "Assessoria ou rede" },
  { v: "SEGURADORA", r: "Seguradora" },
  { v: "MGA", r: "MGA" },
  { v: "BENEFICIOS", r: "Operacao de beneficios" },
];

const OBJETIVOS = [
  { v: "NOVOS_NEGOCIOS", r: "Gerar novos negocios", d: "Temas de dor, solucao e prova, com convite a conversar." },
  { v: "AUTORIDADE", r: "Construir autoridade", d: "Educacao e analise tecnica, com profundidade." },
  { v: "MARCA", r: "Fortalecer a marca", d: "Posicionamento e percepcao, no tom da casa." },
  { v: "RELACIONAMENTO", r: "Ampliar relacionamento", d: "Servico e prevencao para quem ja e cliente." },
];

const CANAIS = [
  { v: "INSTAGRAM", r: "Instagram" },
  { v: "FACEBOOK", r: "Facebook" },
  { v: "LINKEDIN", r: "LinkedIn" },
  { v: "WHATSAPP", r: "WhatsApp" },
  { v: "EMAIL", r: "E-mail" },
  { v: "BLOG", r: "Blog" },
];

const MICROCOPY: Record<string, string> = {
  ACTOR_ROLE_FORBIDDEN: "So o dono do workspace define a estrategia da marca.",
  SCHEMA_VALIDATION_FAILED: "Confira os campos: marca, tipo de operacao, objetivo e ao menos um canal.",
  PROVIDER_UNAVAILABLE: "Nao consegui salvar agora. Tente de novo.",
};

type Marca = { brand_id: string; brand_name: string };
type Perfil = {
  brand_id: string; org_type: string; objective: string; channels: string[];
  o_que_comunica: string | null; como_comunica: string | null; publico_alvo: string | null;
};

export function ProfileForm({ marcas, perfis }: { marcas: Marca[]; perfis: Perfil[] }) {
  const [brand_id, setBrandId] = useState(marcas[0]?.brand_id ?? "");
  const doBanco = perfis.find((p) => p.brand_id === brand_id);

  const [org_type, setOrgType] = useState(doBanco?.org_type ?? "CORRETORA");
  const [objective, setObjective] = useState(doBanco?.objective ?? "NOVOS_NEGOCIOS");
  const [channels, setChannels] = useState<string[]>(doBanco?.channels ?? []);
  const [publico_alvo, setPublico] = useState(doBanco?.publico_alvo ?? "");
  const [o_que_comunica, setOQue] = useState(doBanco?.o_que_comunica ?? "");
  const [como_comunica, setComo] = useState(doBanco?.como_comunica ?? "");

  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  // Trocar de marca carrega o perfil dela. Sem isso, o formulario mostraria
  // a estrategia de uma marca com o nome de outra selecionado.
  function trocarMarca(id: string) {
    setBrandId(id);
    const p = perfis.find((x) => x.brand_id === id);
    setOrgType(p?.org_type ?? "CORRETORA");
    setObjective(p?.objective ?? "NOVOS_NEGOCIOS");
    setChannels(p?.channels ?? []);
    setPublico(p?.publico_alvo ?? "");
    setOQue(p?.o_que_comunica ?? "");
    setComo(p?.como_comunica ?? "");
    setResultado(null);
  }

  const alternarCanal = (c: string) =>
    setChannels((atual) => atual.includes(c) ? atual.filter((x) => x !== c) : [...atual, c]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setResultado(null);
    try {
      const r = await fetch("/api/marketing/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand_id, org_type, objective, channels,
                               publico_alvo, o_que_comunica, como_comunica }),
      });
      const corpo = await r.json().catch(() => ({}));
      setResultado(r.ok
        ? { ok: true, texto: "Estrategia salva. O conteudo gerado a partir de agora segue este perfil." }
        : { ok: false, texto: MICROCOPY[corpo.reason_code] ?? "Nao consegui salvar." });
    } catch {
      setResultado({ ok: false, texto: "Sem conexao. Nada foi salvo." });
    } finally {
      setEnviando(false);
    }
  }

  if (marcas.length === 0) {
    return <p className="muted">Cadastre uma marca antes de definir a estrategia.</p>;
  }

  return (
    <form className="card gerar-form" onSubmit={salvar}>
      <label>
        Marca
        <select value={brand_id} onChange={(e) => trocarMarca(e.target.value)}>
          {marcas.map((m) => <option key={m.brand_id} value={m.brand_id}>{m.brand_name}</option>)}
        </select>
      </label>

      <label>
        Que tipo de operacao e
        <select value={org_type} onChange={(e) => setOrgType(e.target.value)}>
          {ORG_TYPES.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
        </select>
      </label>

      <label>
        Objetivo principal
        <select value={objective} onChange={(e) => setObjective(e.target.value)}>
          {OBJETIVOS.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
        </select>
      </label>
      <p className="muted" style={{ marginTop: "-8px" }}>
        {OBJETIVOS.find((o) => o.v === objective)?.d}
      </p>

      <fieldset className="canais">
        <legend>Onde a empresa publica</legend>
        {CANAIS.map((c) => (
          <label key={c.v} className="canal-item">
            <input
              type="checkbox"
              checked={channels.includes(c.v)}
              onChange={() => alternarCanal(c.v)}
            />
            {c.r}
          </label>
        ))}
      </fieldset>

      <label>
        Para quem fala
        <input value={publico_alvo} onChange={(e) => setPublico(e.target.value)}
               placeholder="ex: diretor financeiro de PME industrial" />
      </label>

      <label>
        O que a empresa comunica
        <textarea value={o_que_comunica} onChange={(e) => setOQue(e.target.value)} rows={3}
                  placeholder="os assuntos que ela domina e quer ser lembrada por" />
      </label>

      <label>
        Como a empresa se comunica
        <textarea value={como_comunica} onChange={(e) => setComo(e.target.value)} rows={3}
                  placeholder="tom, nivel de formalidade, o que evita dizer" />
      </label>

      <button className="btn primario" type="submit" disabled={enviando || channels.length === 0}>
        {enviando ? "Salvando…" : doBanco ? "Atualizar estrategia" : "Salvar estrategia"}
      </button>

      {channels.length === 0 && (
        <p className="muted">Escolha ao menos um canal — e por ele que a estrategia decide o formato.</p>
      )}
      {resultado && <p className={resultado.ok ? "resolvido" : "erro"}>{resultado.texto}</p>}
    </form>
  );
}
