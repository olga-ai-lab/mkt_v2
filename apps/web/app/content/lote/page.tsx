/**
 * Geração em lote (C2).
 *
 * A tela que alimenta os slots do calendário. É também a única do produto em
 * que um clique gasta dinheiro N vezes, e a interface diz isso antes de o
 * clique acontecer — o número de itens, o teto, e o que acontece se o
 * orçamento acabar no meio.
 */
import Link from "next/link";
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import { MAX_POR_LOTE } from "@olga/runtime/batch";
import { GerarEmLote } from "./gerar-em-lote";

export const dynamic = "force-dynamic";

export default async function LotePage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Gerar em lote</h1>
        <p className="muted">Entre na sua conta para gerar conteúdo.</p>
      </main>
    );
  }

  const agente = await ports.registry.getAgent("AGT-MKT-CONTENT");
  const ativo = agente?.status === "ACTIVE";
  const podeUsar = (ativo || ctx.role === "OWNER")
    && (ctx.role === "OWNER" || ctx.role === "MARKETING");

  return (
    <main className="page">
      <header className="page-head">
        <h1>Gerar em lote</h1>
        <p className="muted">
          Um brief por linha. Cada um vira um rascunho com trace próprio, e
          alimenta a fila dos slots do <Link href="/calendar">calendário</Link>.
        </p>
      </header>

      {/*
        O aviso de custo vem antes do formulário, não depois do resultado.
        Depois já não é aviso.
      */}
      <p className="callout aviso">
        Cada item é uma chamada ao modelo, e custa. O lote para na primeira
        recusa de orçamento em vez de tentar os seguintes — os que sobrarem
        voltam para você, sem terem sido gastos. Máximo de {MAX_POR_LOTE} por
        lote.
      </p>

      {!ativo && (
        <p className="callout aviso">
          O <strong>AGT-MKT-CONTENT</strong> ainda é <code>CANDIDATE</code> no
          registry.{" "}
          {ctx.role === "OWNER"
            ? "Como OWNER, você pode exercitá-lo em modo interno."
            : "Enquanto isso, só um OWNER consegue exercitá-lo."}
        </p>
      )}

      {ctx.role !== "OWNER" && ctx.role !== "MARKETING" && (
        <p className="muted">Seu perfil não gera conteúdo.</p>
      )}

      <GerarEmLote podeUsar={podeUsar} interno={!ativo} max={MAX_POR_LOTE} />
    </main>
  );
}
