import type { ReactNode } from "react";
import "@/styles/app.css";

export const metadata = {
  title: "Olga Marketing OS",
  description: "Marketing operado por agentes, com governanca verificavel.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
