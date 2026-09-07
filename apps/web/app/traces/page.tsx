/**
 * Listagem de traces — a porta de entrada da auditoria (A4).
 *
 * A Mestra pede rastreabilidade do pedido ao efeito, e os dados existiam desde
 * a Fase 1: cinco tabelas compartilham `trace_id` e há teste provando que a
 * cadeia liga. O que não existia era como olhar. Até aqui, auditar era escrever
 * SQL sabendo quais eram as cinco tabelas — o que na prática quer dizer que só
 * quem escreveu o schema conseguia auditar.
 *
 * A lista mostra o que serve para escolher o que abrir: quem executou, se
 * terminou, e quantos efeitos externos aquele pedido produziu. Custo aparece
 * porque é a única pergunta operacional que não dá para responder abrindo um
 * trace de cada vez.
 */
import Link from "next/link";
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";

export const dynamic = "force-dynamic";

const instante = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString("pt-BR") : "—";

export default async function TracesPage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Auditoria</h1>
        <p className="muted">Entre na sua conta para ver as execuções deste workspace.</p>
      </main>
    );
  }

  const traces = await ports.trace.list(ctx.org_id, ctx.workspace_id, { limit: 50 });

  return (
    <main className="page">
      <header className="page-head">
        <h1>Auditoria</h1>
        <p className="muted">
          {traces.length === 0
            ? "Nenhuma execução registrada neste workspace ainda."
            : `${traces.length} ${traces.length === 1 ? "execução" : "execuções"}, da mais recente para a mais antiga.`}
        </p>
      </header>

      {traces.length === 0 ? (
        <p className="callout">
          Cada pedido feito a um agente cria um trace, e o trace liga o pedido
          ao efeito: o plano proposto, os passos executados, a evidência citada
          e o recibo de cada ação que saiu daqui.
        </p>
      ) : (
        <ul className="fila">
          {traces.map((t: any) => (
            <li key={t.trace_id} className="card linha">
              <span className={`chip ${t.status === "SUCCEEDED" ? "state-approved" : "state-failed"}`}>
                {String(t.status ?? "—").toLowerCase()}
              </span>
              <strong>{t.agent_id ?? "—"}</strong>
              <span className="muted">{instante(t.started_at)}</span>
              {/*
                Efeito externo é a informação de maior consequência da linha:
                um trace com receipt saiu daqui e chegou num provider. Contar
                zero também importa — diz que aquele pedido não tocou ninguém.
              */}
              <span className="muted">
                {t.receipts === 0
                  ? "nenhum efeito externo"
                  : `${t.receipts} ${t.receipts === 1 ? "efeito externo" : "efeitos externos"}`}
              </span>
              <Link href={`/traces/${encodeURIComponent(t.trace_id)}`}>Abrir</Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
