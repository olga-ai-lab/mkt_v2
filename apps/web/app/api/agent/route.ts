/**
 * POST /api/agent — entrada única do runtime de agentes.
 *
 * O que esta rota faz de mais importante é o que ela NÃO aceita: o corpo do
 * pedido nunca escolhe organização, workspace ou papel. Isso vem da sessão
 * autenticada e é revalidado no servidor (MKT-09B §5).
 *
 * Handler fino de propósito: a decisão vive no loop de agente, que roda em
 * teste sem HTTP. A montagem vive no composition root.
 */
import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@/lib/providers/anthropic";
import { getTrustedContext } from "@/lib/auth";
import { pool } from "@/lib/db";
import { createWorkerApp } from "@olga/worker/composition";

export const runtime = "nodejs";

const { agentLoop } = createWorkerApp({ pool, providers: { anthropic } });

export async function POST(request: NextRequest) {
  // Tenant e ator vêm da sessão. Se o corpo trouxer, o loop recusa.
  const ctx = await getTrustedContext({
    headers: request.headers,
    searchParams: request.nextUrl.searchParams,
  });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!agentLoop) {
    return NextResponse.json(
      { reason_code: "PROVIDER_UNAVAILABLE", message_key: "reason.PROVIDER_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const body = await request.json();

  try {
    const { run_id, response } = await agentLoop.run({
      tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
      actor: { id: ctx.user_id, role: ctx.role, org_id: ctx.org_id },
      agent_id: body.agent_id,
      input: { text: body.text },
      facts: body.facts ?? {},
      requested_autonomy: body.requested_autonomy,
      approval_id: body.approval_id ?? null,
      dry_run: body.dry_run === true,
      // Modo interno roda agente CANDIDATE. Só OWNER, e só se pedir.
      internal: ctx.role === "OWNER" && body.internal === true,
    });

    // `response` ja carrega trace_id; repeti-lo antes faria o spread
    // sobrescrever em silencio. Uma fonte so.
    return NextResponse.json({ ...response, run_id });
  } catch (e: any) {
    // O usuário vê a microcopy do reason code, nunca a mensagem técnica.
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = reason_code === "TENANT_SCOPE_VIOLATION" ? 403
                 : reason_code === "ACTOR_ROLE_FORBIDDEN" ? 403
                 : reason_code === "SPEND_LIMIT_EXCEEDED" ? 402
                 : reason_code === "AGENT_NOT_ACTIVE" ? 409
                 : 503;
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
