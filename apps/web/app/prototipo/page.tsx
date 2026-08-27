/**
 * O protótipo de telas do Marketing OS.
 *
 * ── Por que ele existe aqui, e por que NÃO está em `/` ─────────────────────
 *
 * Estas doze telas foram desenhadas no Lovable, que criou para elas um
 * repositório próprio (`olga-ai-lab/marketplace-sync`) em vez de sincronizar
 * com este. O desenho é bom e não se perde; o repositório separado é que não
 * se sustenta — dois repositórios para um produto viram duas verdades sobre
 * como ele funciona, e a que ninguém mantém é a que alguém acaba lendo.
 *
 * ── O aviso na tela não é decoração ────────────────────────────────────────
 *
 * TODO o conteúdo abaixo é DADO DE MENTIRA, escrito à mão dentro de
 * `mktos/logic.ts`. Nada aqui chama uma API, lê o banco ou passa pelo
 * Capability Gateway. Os botões mudam estado em memória e o "publicado" da
 * tela nunca saiu para lugar nenhum.
 *
 * Uma tela que parece o produto e não é o produto é a coisa mais perigosa que
 * este repositório pode conter — é o mesmo defeito que a coluna vazia, o eval
 * que aprova o caminho errado e o kill switch que grava e não bloqueia. Por
 * isso ela mora em `/prototipo`, com faixa fixa no topo, e não em `/`.
 *
 * As telas que JÁ têm produto atrás delas são outras, e estão em `/approvals`,
 * `/content`, `/brands/[id]/brain` e `/login`. Ver `mktos/README.md` para o
 * mapa de qual protótipo corresponde a qual coisa real.
 */
"use client";

import { MktosProvider } from "@/mktos/store";
import MarketingOS from "@/mktos/MarketingOS";

export default function Prototipo() {
  return (
    <>
      <div
        role="note"
        style={{
          position: "sticky", top: 0, zIndex: 9999,
          background: "#9A6B00", color: "#fff",
          padding: "8px 16px", fontSize: 13, lineHeight: 1.4,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <strong>Protótipo — dados de mentira.</strong>{" "}
        Nada nesta página chama a API, lê o banco ou publica. Serve para
        desenhar as telas. O produto de verdade está em{" "}
        <a href="/" style={{ color: "#fff", textDecoration: "underline" }}>
          Início
        </a>.
      </div>
      <MktosProvider>
        <MarketingOS />
      </MktosProvider>
    </>
  );
}
