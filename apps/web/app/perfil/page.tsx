/**
 * Perfil da empresa — revisar e promover.
 *
 * O AGT-MKT-BRAND lê o site, mapeia o que encontrou para os ids canônicos da
 * taxonomia do mercado e grava uma versão CANDIDATE. Promover é humano, e é
 * aqui que isso acontece.
 *
 * ── O que esta tela mostra e a do Brand Brain não mostrava ────────────────
 *
 * As LACUNAS, em primeiro plano. O perfil declara o que a leitura não
 * respondeu — público-alvo que o site não diz, código que o modelo tentou usar
 * e não existe na taxonomia, a ressalva de que a taxonomia ainda não foi
 * curada. Quem promove precisa ver o que o perfil NÃO diz antes de dizer que
 * ele vale, porque todo conteúdo gerado depois herda produto, público e tom.
 */
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import { headers } from "next/headers";
import { PerfilBoard } from "./perfil-board";

export const dynamic = "force-dynamic";

type Linha = Record<string, any>;

export default async function PerfilPage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Perfil da empresa</h1>
        <p className="muted">Entre na sua conta para ver os perfis deste workspace.</p>
      </main>
    );
  }

  const [linhas, pendentes] = await Promise.all([
    ports.knowledge.companyProfileBoard(ctx.org_id, ctx.workspace_id) as Promise<Linha[]>,
    ports.taxonomy.pendingCuration(),
  ]);

  const porMarca = new Map<string, any>();
  for (const l of linhas) {
    if (!porMarca.has(l.brand_id)) {
      porMarca.set(l.brand_id, {
        brand_id: l.brand_id, brand_name: l.brand_name,
        website_url: l.website_url, ativa: null, candidatas: [],
      });
    }
    if (!l.version_id) continue;
    const versao = {
      version_id: l.version_id, version: l.version, status: l.status,
      company_type: l.company_type,
      identity: l.identity ?? {},
      tone_axes: l.tone_axes ?? {},
      tone_observed: l.tone_observed ?? {},
      voice_examples: l.voice_examples ?? [],
      prohibitions: l.prohibitions ?? [],
      disclaimers: l.disclaimers ?? [],
      gaps: l.gaps ?? [],
      products: l.products ?? [],
      audiences: l.audiences ?? [],
      carriers: l.carriers ?? [],
      sources: l.sources ?? [],
      created_at: String(l.created_at),
      criado_por_tipo: l.criado_por_tipo,
      activated_at: l.activated_at ? String(l.activated_at) : null,
      ativado_por: l.ativado_por,
    };
    const m = porMarca.get(l.brand_id);
    if (l.status === "ACTIVE") m.ativa = versao;
    else m.candidatas.push(versao);
  }

  const marcas = [...porMarca.values()];
  const esperando = marcas.reduce((n, m) => n + m.candidatas.length, 0);
  // A taxonomia nasce CANDIDATE e o código só lê ACTIVE. Enquanto ninguém
  // curou, um perfil promovido aponta para vocabulário que ainda não vale — e
  // quem promove precisa saber disso antes, não depois.
  const taxonomiaCurada = pendentes.products === 0 || undefined;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Perfil da empresa</h1>
        <p className="muted">
          {marcas.length === 0
            ? "Nenhuma marca cadastrada neste workspace."
            : esperando === 0
              ? `${marcas.length} marca(s), nenhum perfil esperando decisão.`
              : `${esperando} perfil(is) proposto(s) esperando sua decisão.`}
        </p>
      </header>

      {!taxonomiaCurada && (
        <p className="card muted">
          A taxonomia do mercado ainda não foi curada — {pendentes.products} produto(s) e{" "}
          {pendentes.terms} termo(s) esperando revisão. Os códigos que aparecem nos perfis
          abaixo vieram dessa carga, e cada perfil registra isso nas próprias lacunas.
        </p>
      )}

      <PerfilBoard marcas={marcas} podePromover={ctx.role === "OWNER"} />
    </main>
  );
}
