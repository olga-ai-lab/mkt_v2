/**
 * Brand Brain — revisar e promover.
 *
 * Esta tela existe porque o AGT-MKT-BRAND propõe e não promove. Ele lê o site
 * do cliente, estrutura o que encontrou e grava uma versão CANDIDATE; a
 * promoção para ACTIVE é sempre humana, e está declarada como desvio no
 * registry dele.
 *
 * Sem esta tela, o trabalho daquele agente terminava numa linha de banco que
 * ninguém conseguia aceitar.
 *
 * ── Por que mostra a ACTIVE junto ─────────────────────────────────────────
 *
 * Porque promover é substituir. Uma tela que mostrasse só a candidata pediria
 * uma decisão sobre o que muda sem mostrar o que havia antes — e o erro mais
 * caro deste papel é registrar como fato da marca algo que o site não
 * sustenta, porque todo conteúdo gerado depois herda o erro.
 */
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import { headers } from "next/headers";
import { BrandBoard } from "./brand-board";

export const dynamic = "force-dynamic";

type Linha = Record<string, any>;

export default async function BrandPage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Brand Brain</h1>
        <p className="muted">Entre na sua conta para ver as marcas deste workspace.</p>
      </main>
    );
  }

  const linhas: Linha[] = await ports.knowledge.brandBrainBoard(ctx.org_id, ctx.workspace_id);

  // Agrupa por marca. A consulta traz uma linha por versão; a tela raciocina
  // por marca, e é aqui que a diferença é resolvida — não no SQL, que ficaria
  // com um json_agg difícil de ler para servir uma decisão de layout.
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
      identity: l.identity, tone: l.tone,
      claims_allowed: l.claims_allowed ?? [],
      prohibitions: l.prohibitions ?? [],
      disclaimers: l.disclaimers ?? [],
      source_refs: l.source_refs ?? [],
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
  const pendentes = marcas.reduce((n, m) => n + m.candidatas.length, 0);

  return (
    <main className="page">
      <header className="page-head">
        <h1>Brand Brain</h1>
        <p className="muted">
          {marcas.length === 0
            ? "Nenhuma marca cadastrada neste workspace."
            : pendentes === 0
              ? `${marcas.length} marca(s), nenhuma versão esperando decisão.`
              : `${pendentes} versão(ões) candidata(s) esperando sua decisão.`}
        </p>
      </header>

      <BrandBoard marcas={marcas} podePromover={ctx.role === "OWNER"} />
    </main>
  );
}
