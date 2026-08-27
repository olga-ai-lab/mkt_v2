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
          <Link href="/brand">Brand Brain</Link>
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
