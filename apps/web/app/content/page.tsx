/**
 * Listagem de conteúdo do workspace, com a ação de publicar.
 *
 * A tela oferece publicar apenas onde as três condições existem: o conteúdo
 * está APPROVED, há variante para o canal, e há conexão ativa naquele canal.
 * Isso não substitui a policy — ela reavalia tudo no gateway. Serve para não
 * oferecer um botão que só existe para dar erro.
 */
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import { ContentList } from "./content-list";
import { GenerateContentForm } from "./generate-form";

export const dynamic = "force-dynamic";

export default async function ContentPage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Conteúdo</h1>
        <p className="muted">Entre na sua conta para ver este workspace.</p>
      </main>
    );
  }

  const [conteudos, conexoes, marcasBoard] = await Promise.all([
    ports.content.listByWorkspace(ctx.org_id, ctx.workspace_id, { limit: 100 }),
    ports.content.listConnections(ctx.org_id, ctx.workspace_id),
    ports.knowledge.brandBrainBoard(ctx.org_id, ctx.workspace_id),
  ]);

  // Só marca com Brand Brain ACTIVE pode virar conteúdo: pedir para as
  // outras é recusado lá na frente com BRAND_BRAIN_NOT_ACTIVE. Filtrar aqui
  // poupa esse passeio.
  const marcasComMarcaAtiva = [
    ...new Map<string, { brand_id: string; brand_name: string }>(
      marcasBoard
        .filter((l: any) => l.status === "ACTIVE")
        .map((l: any) => [l.brand_id, { brand_id: l.brand_id, brand_name: l.brand_name }]),
    ).values(),
  ];

  const ativas = conexoes.filter((c: any) => c.status === "ACTIVE");

  const itens = conteudos.map((c: any) => ({
    content_version_id: c.content_version_id,
    title: c.title,
    version: c.version,
    state: c.state,
    risk_tier: c.risk_tier,
    master_body: c.master_body,
    publicados: (c.publications ?? []).map((p: any) => p.channel),
    // Um destino é um par variante+conexão que existe de verdade.
    destinos: (c.variants ?? [])
      .map((v: any) => {
        const conn = ativas.find((k: any) => k.channel === v.channel);
        return conn ? { channel: v.channel, channel_variant_id: v.id, connection_id: conn.id } : null;
      })
      .filter(Boolean),
  }));

  return (
    <main className="page">
      <header className="page-head">
        <h1>Conteúdo</h1>
        <p className="muted">
          {itens.length === 0 ? "Nada criado ainda." : `${itens.length} no workspace.`}
        </p>
      </header>

      {/* AGT-MKT-CONTENT é CANDIDATE: roda internal, e internal é só OWNER
          (apps/web/app/api/agent/route.ts). Sem isso o formulário chamaria
          a rota só para levar ACTOR_ROLE_FORBIDDEN de volta. */}
      {ctx.role === "OWNER" && <GenerateContentForm marcas={marcasComMarcaAtiva} />}

      <ContentList itens={itens} podePublicar={ctx.role === "OWNER" || ctx.role === "MARKETING"} />
    </main>
  );
}
