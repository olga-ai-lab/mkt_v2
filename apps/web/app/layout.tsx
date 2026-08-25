import type { ReactNode } from "react";
import Link from "next/link";
import "@/styles/app.css";

export const metadata = {
  title: "Olga Marketing OS",
  description: "Marketing operado por agentes, com governanca verificavel.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <nav className="topo">
          <Link href="/">Início</Link>
          <Link href="/approvals">Aprovações</Link>
          <Link href="/content">Conteúdo</Link>
        </nav>
        {children}
      </body>
    </html>
  );
}
