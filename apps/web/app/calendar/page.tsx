/**
 * Calendário editorial (C2).
 *
 * Leitura pura sobre o que já existe: `publications` com data e os slots
 * recorrentes. Não há tabela de calendário, e não deveria haver — um
 * calendário que guardasse as próprias linhas seria uma segunda verdade sobre
 * o que vai ao ar, e um dia discordaria de `publications`.
 *
 * O passado e o futuro aparecem juntos de propósito. Um calendário que só
 * mostrasse o que vem não deixaria notar a semana que ficou vazia.
 */
import Link from "next/link";
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import messages from "@/messages/reason-codes.pt-BR.json";

export const dynamic = "force-dynamic";

const dia = (v: unknown) =>
  v ? new Date(String(v)).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" }) : "—";
const hora = (v: unknown) =>
  v ? new Date(String(v)).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";

const CADENCIA: Record<string, string> = { DAILY: "todo dia", WEEKLY: "toda semana", MONTHLY: "todo mês" };
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Como um slot se descreve em uma linha. */
function descreverSlot(s: any) {
  const quando = s.cadence === "WEEKLY" ? `toda ${DIAS[s.at_weekday]}`
               : s.cadence === "MONTHLY" ? `todo dia ${s.at_monthday}`
               : CADENCIA[s.cadence] ?? s.cadence;
  return `${quando}, ${String(s.at_hour_utc).padStart(2, "0")}h UTC`;
}

const RESULTADO: Record<string, string> = {
  SCHEDULED: "agendou na última vez",
  NO_CONTENT: "não havia conteúdo aprovado na última vez",
  BLOCKED: "bloqueado na última vez",
};

export default async function CalendarPage() {
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Calendário</h1>
        <p className="muted">Entre na sua conta para ver o calendário deste workspace.</p>
      </main>
    );
  }

  // Uma janela de cinco semanas: a que passou e as quatro seguintes.
  const de = new Date(Date.now() - 7 * 86400000);
  const ate = new Date(Date.now() + 28 * 86400000);

  const [marcados, slots, prontos] = await Promise.all([
    ports.calendar.range(ctx.org_id, ctx.workspace_id, { de, ate }),
    ports.schedules.listByWorkspace(ctx.org_id, ctx.workspace_id),
    ports.calendar.prontosPorCanal(ctx.org_id, ctx.workspace_id),
  ]);

  // Agrupado por dia: é assim que um calendário é lido.
  const porDia = new Map<string, any[]>();
  for (const m of marcados) {
    const chave = new Date(String(m.quando)).toISOString().slice(0, 10);
    porDia.set(chave, [...(porDia.get(chave) ?? []), m]);
  }

  return (
    <main className="page">
      <header className="page-head">
        <h1>Calendário</h1>
        <p className="muted">
          O que já saiu e o que está marcado, da semana passada às próximas quatro.
        </p>
      </header>

      <section>
        <h2>Slots recorrentes</h2>
        {slots.length === 0 ? (
          <p className="muted">
            Nenhum slot configurado. Um slot é um horário fixo no calendário —
            cada ocorrência publica o próximo conteúdo aprovado daquele canal.
          </p>
        ) : (
          <ul className="fila">
            {slots.map((s: any) => (
              <li key={s.id} className="card linha">
                <span className={`chip ${s.active ? "state-approved" : "state-rejected"}`}>
                  {s.active ? "ativo" : "pausado"}
                </span>
                <strong>{s.channel}</strong>
                <span className="muted">{descreverSlot(s)}</span>
                <span className="muted">próximo: {dia(s.next_run_at)} {hora(s.next_run_at)}</span>
                {s.last_outcome && (
                  <span className="muted">
                    {RESULTADO[s.last_outcome] ?? s.last_outcome}
                    {s.last_reason_code && ` — ${(messages as Record<string, string>)[s.last_reason_code] ?? s.last_reason_code}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        A fila de prontos é o que decide se vale gerar mais. Um slot diário com
        dois aprovados na fila fica sem conteúdo em dois dias — e sem este
        número, o calendário mostraria ocorrências vazias sem dizer por quê.
      */}
      <section>
        <h2>Pronto para os slots</h2>
        {prontos.length === 0 ? (
          <p className="callout aviso">
            Nenhum conteúdo aprovado esperando. Os slots que vencerem não terão o
            que publicar. <Link href="/content/lote">Gerar em lote</Link>.
          </p>
        ) : (
          <ul className="numeros">
            {prontos.map((p: any) => (
              <li key={p.channel} className="card numero">
                <strong>{p.prontos}</strong>
                <span>aprovados para {p.channel}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Marcados</h2>
        {porDia.size === 0 ? (
          <p className="muted">Nada marcado nesta janela.</p>
        ) : (
          <ul className="fila">
            {[...porDia.entries()].map(([data, itens]) => (
              <li key={data} className="card">
                <div className="card-head">
                  <span className="eyebrow">{dia(itens[0].quando)}</span>
                </div>
                <ul className="motivos">
                  {itens.map((m: any) => (
                    <li key={m.id}>
                      <span className={`chip ${m.status === "PUBLISHED" ? "state-published" : "state-scheduled"}`}>
                        {m.status.toLowerCase()}
                      </span>{" "}
                      {hora(m.quando)} · <strong>{m.title}</strong> · {m.channel}
                      {m.trace_id && (
                        <> · <Link href={`/traces/${encodeURIComponent(m.trace_id)}`}>trace</Link></>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
