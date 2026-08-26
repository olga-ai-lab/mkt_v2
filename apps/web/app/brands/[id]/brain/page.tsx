/**
 * Brand Brain de uma marca: as versoes, e a que vale.
 *
 * Esta tela existe porque a cadeia da Fase 2 termina numa versao CANDIDATE e
 * ninguem podia faze-la valer. O agente le a pagina, confere o que tem lastro e
 * propoe; daqui em diante e uma pessoa que assume.
 *
 * O que ela mostra sem que ninguem peca: o que a extracao NAO conseguiu
 * preencher. Uma versao vinda de site chega sempre sem proibicoes — uma pagina
 * diz o que a marca fala, nao o que ela se recusa a falar — e proibicao vazia e
 * um compliance.review conferindo lista vazia para sempre.
 */
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { brandActivationService, ports } from "@/lib/db";
import { BrandBrainVersions } from "./brand-brain-versions";

export const dynamic = "force-dynamic";

export default async function BrandBrainPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTrustedContext({ headers: await headers() });
  const { id } = await params;

  if (!ctx) {
    return (
      <main className="page">
        <h1>Brand Brain</h1>
        <p className="muted">Entre na sua conta para ver esta marca.</p>
      </main>
    );
  }

  const marca = await ports.knowledge.brand(ctx.org_id, id);
  if (!marca) {
    return (
      <main className="page">
        <h1>Brand Brain</h1>
        <p className="muted">Não encontrei essa marca neste workspace.</p>
      </main>
    );
  }

  const versoes = await brandActivationService.list({
    tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
    brand_id: id,
  });

  const itens = versoes.map((v: any) => ({
    id: String(v.id),
    version: v.version,
    status: v.status,
    origem: v.created_by_actor_type,
    created_at: String(v.created_at),
    activated_at: v.activated_at ? String(v.activated_at) : null,
    identity: v.identity ?? {},
    tone: v.tone ?? {},
    claims_allowed: v.claims_allowed ?? [],
    prohibitions: v.prohibitions ?? [],
    disclaimers: v.disclaimers ?? [],
    source_refs: v.source_refs ?? [],
    gaps: v.gaps ?? [],
  }));

  const ativa = itens.find((v: { status: string }) => v.status === "ACTIVE") ?? null;

  return (
    <main className="page">
      <header className="page-head">
        <h1>{marca.name}</h1>
        <p className="muted">
          {ativa
            ? `Versão ${ativa.version} é a que vale hoje.`
            : "Nenhuma versão ativa: o agente ainda não escreve para esta marca."}
        </p>
      </header>

      {/*
        Sem Brand Brain ativo, content.create_draft recusa com
        BRAND_BRAIN_NOT_ACTIVE. Dizer isso aqui evita que alguem conclua que o
        agente esta quebrado quando ele esta obedecendo.
      */}
      {!ativa && itens.length > 0 && (
        <p className="callout aviso">
          Enquanto nenhuma versão estiver ativa, o agente recusa criar conteúdo
          para esta marca. Reveja a candidata abaixo e ative a que representa a marca.
        </p>
      )}

      {itens.length === 0 && (
        <p className="callout">
          Esta marca ainda não tem nenhuma versão de Brand Brain.
          {marca.website_url
            ? " Peça ao agente para montar uma a partir do site cadastrado."
            : " Cadastre o site da marca para o agente poder ler."}
        </p>
      )}

      <BrandBrainVersions brandId={id} itens={itens} podeAtivar={ctx.role === "OWNER"} />
    </main>
  );
}
