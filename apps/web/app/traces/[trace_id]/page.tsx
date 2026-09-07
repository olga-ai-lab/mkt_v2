/**
 * A linha do tempo de uma execução: pedido → plano → passos → efeito → aviso.
 *
 * Esta tela LÊ o rastro; não o calcula. A ordem vem do banco, os reason codes
 * vêm do registro, e o microcopy vem do mesmo arquivo que todas as outras
 * telas usam. Recalcular qualquer uma dessas coisas aqui criaria uma segunda
 * versão da verdade justamente na tela cuja razão de existir é ser confiável.
 *
 * A distinção que a tela nunca esconde é entre o que aconteceu AQUI DENTRO e o
 * que saiu para um provider. Um receipt com external_id é a única prova de
 * efeito material — e é a diferença entre auditoria e log.
 */
import Link from "next/link";
import { headers } from "next/headers";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";
import messages from "@/messages/reason-codes.pt-BR.json";

export const dynamic = "force-dynamic";

const instante = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString("pt-BR") : "—";

/** O que cada fonte significa para quem audita, em uma linha. */
const FONTES: Record<string, { rotulo: string; explica: string }> = {
  agent_run: { rotulo: "execução", explica: "um agente rodou o loop completo" },
  audit_event: { rotulo: "registro", explica: "decisão registrada na trilha de auditoria" },
  receipt: { rotulo: "efeito", explica: "ação executada pelo Capability Gateway" },
  evento: { rotulo: "evento", explica: "aviso publicado no barramento" },
  workflow: { rotulo: "workflow", explica: "execução durável da publicação" },
};

function Passos({ payload }: { payload: any }) {
  const steps = payload?.steps ?? [];
  if (!Array.isArray(steps) || steps.length === 0) return null;
  return (
    <div className="bb-campo">
      <h4>Plano proposto <span className="muted">({steps.length})</span></h4>
      <ol>
        {steps.map((s: any, n: number) => (
          <li key={n}>
            <code>{s.capability_id}</code>
            {/*
              `args_summary` é prosa humana por contrato: os argumentos reais
              nascem no compilador, nunca no modelo. Mostrar o resumo aqui é
              mostrar o que o modelo propôs — que é o que se audita.
            */}
            {s.args_summary && <> — {s.args_summary}</>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Efeito({ d }: { d: any }) {
  return (
    <div className="bb-campo">
      <h4>Efeito registrado</h4>
      <p>
        <code>{d.capability_id}</code> via <strong>{d.provider ?? "interno"}</strong>
        {d.external_id && <> · id no provider <code>{d.external_id}</code></>}
      </p>
      <p className="muted">
        autonomia {d.autonomy_used}
        {d.approval_id && <> · autorizado pela aprovação {String(d.approval_id).slice(0, 8)}</>}
      </p>
    </div>
  );
}

export default async function TracePage({ params }: { params: Promise<{ trace_id: string }> }) {
  const { trace_id } = await params;
  const ctx = await getTrustedContext({ headers: await headers() });

  if (!ctx) {
    return (
      <main className="page">
        <h1>Trace</h1>
        <p className="muted">Entre na sua conta para ver esta execução.</p>
      </main>
    );
  }

  // O tenant vem do contexto confiável e entra na consulta. Um trace_id na URL
  // é palpite de quem digitou; ele nunca escolhe organização.
  const t = await ports.trace.byTraceId(ctx.org_id, decodeURIComponent(trace_id));

  if (!t.encontrado) {
    return (
      <main className="page">
        <header className="page-head">
          <h1>Trace</h1>
          <p className="muted"><code>{trace_id}</code></p>
        </header>
        {/*
          Sem distinguir "não existe" de "não é seu": as duas respostas juntas
          impedem que a tela sirva para descobrir traces de outra organização.
        */}
        <p className="callout">
          Nenhuma execução com este identificador neste workspace.
        </p>
        <p><Link href="/traces">Voltar para a auditoria</Link></p>
      </main>
    );
  }

  const efeitos = t.eventos.filter((e: any) => e.fonte === "receipt").length;

  return (
    <main className="page">
      <header className="page-head">
        <h1>Trace</h1>
        <p className="muted"><code>{t.trace_id}</code></p>
      </header>

      <p className="callout">
        {efeitos === 0
          ? "Esta execução não produziu nenhum efeito externo: nada saiu daqui para um provider."
          : `Esta execução produziu ${efeitos} ${efeitos === 1 ? "efeito externo" : "efeitos externos"}, cada um com recibo próprio.`}
      </p>

      <ul className="fila">
        {t.eventos.map((e: any, n: number) => {
          const fonte = FONTES[e.fonte] ?? { rotulo: e.fonte, explica: "" };
          return (
            <li key={n} className="card">
              <div className="card-head">
                <span className="eyebrow">{fonte.rotulo}</span>
                <strong>{e.titulo}</strong>
                {e.status && <span className="chip">{String(e.status).toLowerCase()}</span>}
                <span className="muted">{instante(e.instante)}</span>
              </div>
              <p className="muted">{fonte.explica}</p>

              {e.fonte === "audit_event" && <Passos payload={e.detalhe.payload} />}
              {e.fonte === "receipt" && <Efeito d={e.detalhe} />}

              {e.reason_codes?.length > 0 && (
                <ul className="motivos">
                  {e.reason_codes.map((c: string) => (
                    <li key={c}>{(messages as Record<string, string>)[c] ?? c}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <p><Link href="/traces">Voltar para a auditoria</Link></p>
    </main>
  );
}
