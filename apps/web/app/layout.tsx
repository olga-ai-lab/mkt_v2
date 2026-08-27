import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import "@/styles/app.css";

export const metadata = {
  title: "Olga Marketing OS",
  description: "Marketing operado por agentes, com governanca verificavel.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Isto controla apenas a navegacao. Autorizacao continua sendo feita por
  // getTrustedContext, com assinatura e membership conferidas no servidor.
  const hasSessionCookie = Boolean((await cookies()).get("sb-access-token")?.value);
  return (
    <html lang="pt-BR">
      <body>
        <nav className="topo">
          <Link href="/">Início</Link>
          <Link href="/approvals">Aprovações</Link>
          <Link href="/content">Conteúdo</Link>
          {/*
            Rotulado "Protótipo" e separado do resto de propósito: as três
            primeiras rotas mostram o banco, esta mostra dado escrito à mão.
            Um link que não dissesse isso faria alguém apresentar a tela de
            desempenho para um cliente.
          */}
          <Link href="/prototipo">Protótipo</Link>
          <span className="nav-spacer" />
          {hasSessionCookie ? (
            <form action="/api/auth/logout" method="post">
              <button type="submit">Sair</button>
            </form>
          ) : <Link href="/login">Entrar</Link>}
        </nav>
        {children}
      </body>
    </html>
  );
}
