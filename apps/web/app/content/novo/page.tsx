/**
 * Criar conteúdo (A2): o botão que dispara o agente.
 *
 * Até aqui o AGT-MKT-CONTENT existia inteiro — charter, compiladores,
 * capabilities internas, evals — e não havia por onde pedir nada a ele. O
 * produto tinha backend e não tinha uso.
 *
 * A tela não cria rota nova: manda para `POST /api/agent`, a entrada única do
 * runtime. Uma segunda porta de entrada seria um segundo lugar onde tenant,
 * papel e autonomia precisariam ser conferidos.
 *
 * ── O que a tela precisa dizer antes de oferecer o botão ────────────────────
 *
 * O AGT-MKT-CONTENT é `CANDIDATE`, e `api/agent/route.ts` só o aceita em modo
 * interno, para `OWNER`. Um botão oferecido a quem não é OWNER existiria só
 * para devolver `AGENT_NOT_ACTIVE`. Dizer a razão é mais útil que esconder o
 * botão em silêncio — é a mesma escolha que a listagem de conteúdo já faz com
 * "aprovado, mas sem destino".
 */
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import { CriarConteudo } from "./criar-conteudo";

export const dynamic = "force-dynamic";

export default async function NovoConteudoPage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Criar conteúdo</h1>
        <p className="muted">Entre na sua conta para pedir um texto ao agente.</p>
      </main>
    );
  }

  // O status vem do registry, e não de uma constante nesta tela. Quando a
  // migration que promove o agente for aplicada, a tela muda sozinha — e se
  // alguém o rebaixar, ela volta a avisar sem que ninguém precise lembrar.
  const agente = await ports.registry.getAgent("AGT-MKT-CONTENT");
  const ativo = agente?.status === "ACTIVE";
  const podeUsar = ativo || ctx.role === "OWNER";

  return (
    <main className="page">
      <header className="page-head">
        <h1>Criar conteúdo</h1>
        <p className="muted">
          O agente lê o Brand Brain ativo e a evidência do workspace, e escreve
          um rascunho. Ele não publica.
        </p>
      </header>

      {!ativo && (
        <p className="callout aviso">
          O <strong>AGT-MKT-CONTENT</strong> ainda é <code>CANDIDATE</code> no
          registry: ele escreve, e promover um agente que escreve é ato de
          governança com migration própria.{" "}
          {ctx.role === "OWNER"
            ? "Como OWNER, você pode exercitá-lo em modo interno — o rascunho é real e fica no workspace."
            : "Enquanto isso, só um OWNER consegue exercitá-lo."}
        </p>
      )}

      <CriarConteudo podeUsar={podeUsar} interno={!ativo} />
    </main>
  );
}
