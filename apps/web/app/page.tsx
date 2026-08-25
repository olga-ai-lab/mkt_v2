/**
 * Home. Mostra o que exige ação e o que impede publicar.
 *
 * Não é um dashboard de vaidade: cada número aqui ou pede uma decisão, ou
 * explica por que algo não vai sair. Contagem que não leva a lugar nenhum
 * ocupa espaço e não ajuda a operar.
 */
import Link from "next/link";
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { approvalService, ports } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Olga Marketing OS</h1>
        <p className="muted">Entre na sua conta para ver este workspace.</p>
      </main>
    );
  }

  const [pendentes, conteudos, conexoes] = await Promise.all([
    approvalService.listPending({ org_id: ctx.org_id, workspace_id: ctx.workspace_id }),
    ports.content.listByWorkspace(ctx.org_id, ctx.workspace_id, { limit: 100 }),
    ports.content.listConnections(ctx.org_id, ctx.workspace_id),
  ]);

  const aprovados = conteudos.filter((c: any) => c.state === "APPROVED").length;
  const publicados = conteudos.filter((c: any) => c.state === "PUBLISHED").length;
  const conexoesAtivas = conexoes.filter((c: any) => c.status === "ACTIVE");

  return (
    <main className="page">
      <header className="page-head">
        <h1>Olga Marketing OS</h1>
        <p className="muted">Workspace atual · seu perfil é {ctx.role}.</p>
      </header>

      <ul className="numeros">
        <li className="card numero">
          <strong>{pendentes.length}</strong>
          <span>{pendentes.length === 1 ? "item espera decisão" : "itens esperam decisão"}</span>
          {pendentes.length > 0 && <Link href="/approvals">Abrir a fila</Link>}
        </li>
        <li className="card numero">
          <strong>{aprovados}</strong>
          <span>{aprovados === 1 ? "aprovado, pronto para publicar" : "aprovados, prontos para publicar"}</span>
          {aprovados > 0 && <Link href="/content">Ver conteúdo</Link>}
        </li>
        <li className="card numero">
          <strong>{publicados}</strong>
          <span>{publicados === 1 ? "publicado" : "publicados"}</span>
        </li>
      </ul>

      {/*
        Sem conexão ativa nenhuma publicação sai — a policy bloqueia com
        CHANNEL_NOT_CONNECTED antes de qualquer chamada externa. Dizer isso
        aqui evita que alguém aprove uma fila inteira e só descubra depois.
      */}
      {conexoesAtivas.length === 0 && (
        <p className="callout aviso">
          Nenhum canal conectado neste workspace. Nada será publicado até que
          exista uma conexão ativa — as publicações ficam bloqueadas antes de
          qualquer chamada externa.
        </p>
      )}

      <section>
        <h2>Canais</h2>
        {conexoes.length === 0 ? (
          <p className="muted">Nenhum canal conectado ainda.</p>
        ) : (
          <ul className="fila">
            {conexoes.map((c: any) => (
              <li key={c.id} className="card linha">
                <span className={`chip ${c.status === "ACTIVE" ? "state-approved" : "state-failed"}`}>
                  {c.status === "ACTIVE" ? "conectado" : c.status.toLowerCase()}
                </span>
                <strong>{c.channel}</strong>
                <span className="muted">{c.display_name ?? c.external_account_id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
