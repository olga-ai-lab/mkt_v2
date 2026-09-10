/**
 * Perfil de marketing — a estrategia que o conteudo herda.
 *
 * Esta tela existe porque o AGT-MKT-CONTENT passou a escrever DENTRO de
 * uma estrategia declarada (migration 0012). Sem ela, o perfil so poderia
 * ser preenchido por INSERT, e a capability escreveria sem template para
 * sempre — com a degradacao invisivel de "funciona, mas nao aplica nada".
 *
 * Mostra os modulos do objetivo escolhido junto do formulario: o que a
 * plataforma prioriza para aquele objetivo e a mesma tabela que decide
 * qual template atende — e quem escolhe merece ver o que a escolha muda.
 */
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export default async function PerfilPage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Perfil de marketing</h1>
        <p className="muted">Entre na sua conta para definir a estrategia deste workspace.</p>
      </main>
    );
  }

  const linhas: any[] = await ports.knowledge.brandBrainBoard(ctx.org_id, ctx.workspace_id);
  const marcas = [
    ...new Map<string, { brand_id: string; brand_name: string }>(
      linhas.map((l) => [l.brand_id, { brand_id: l.brand_id, brand_name: l.brand_name }]),
    ).values(),
  ];

  // Um perfil por marca. Buscar todos de uma vez deixa o formulario trocar
  // de marca sem ida ao servidor.
  const perfis = (
    await Promise.all(marcas.map((m) => ports.knowledge.marketingProfile(ctx.org_id, m.brand_id)))
  ).filter(Boolean);

  return (
    <main className="page">
      <header className="page-head">
        <h1>Perfil de marketing</h1>
        <p className="muted">
          {perfis.length === 0
            ? "Nenhuma marca com estrategia definida. Enquanto nao houver, o conteudo e escrito sem template."
            : `${perfis.length} de ${marcas.length} marca(s) com estrategia definida.`}
        </p>
      </header>

      <ProfileForm marcas={marcas} perfis={perfis as any} />

      {ctx.role !== "OWNER" && (
        <p className="muted">
          Seu perfil ve a estrategia, mas so o dono do workspace pode altera-la.
        </p>
      )}
    </main>
  );
}
