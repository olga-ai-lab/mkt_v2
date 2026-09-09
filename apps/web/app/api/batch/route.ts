/**
 * POST /api/batch — geração em lote (C2).
 *
 * Esta rota existe, e não a tela chamando `/api/agent` N vezes, por um motivo
 * só: o freio. Um cliente que fizesse N chamadas soltas receberia a primeira
 * recusa de orçamento e continuaria mandando as outras — e a contenção
 * dependeria do navegador de quem clicou.
 *
 * O lote não é um segundo caminho de execução: cada item passa pelo MESMO
 * `agentLoop` que `/api/agent` monta. O que muda é quem decide parar.
 */
import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@/lib/providers/anthropic";
import { getTrustedContext } from "@/lib/auth";
import { pool } from "@/lib/db";
import { createWorkerApp } from "@olga/worker/composition";
import { createBatchRunner, MAX_POR_LOTE } from "@olga/runtime/batch";

export const runtime = "nodejs";

const { agentLoop } = createWorkerApp({ pool, providers: { anthropic } });

export async function POST(request: NextRequest) {
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

  // Gerar em lote gasta dinheiro por item. É a mesma classe de decisão que
  // publicar, e o papel exigido é o mesmo.
  if (ctx.role !== "OWNER" && ctx.role !== "MARKETING") {
    return NextResponse.json(
      { reason_code: "ACTOR_ROLE_FORBIDDEN", message_key: "reason.ACTOR_ROLE_FORBIDDEN" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const rodar = createBatchRunner({ agentLoop });

  try {
    const r = await rodar({
      tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
      actor: { id: ctx.user_id, role: ctx.role, org_id: ctx.org_id },
      agent_id: "AGT-MKT-CONTENT",
      briefs: Array.isArray(body.briefs) ? body.briefs : [],
      internal: ctx.role === "OWNER" && body.internal === true,
    });
    return NextResponse.json({ ...r, max_por_lote: MAX_POR_LOTE });
  } catch (e: any) {
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = reason_code === "UNSUPPORTED_VALUE" ? 400
                 : reason_code === "SCHEMA_VALIDATION_FAILED" ? 400
                 : reason_code === "TENANT_SCOPE_VIOLATION" ? 403
                 : 503;
    return NextResponse.json(
      { reason_code, message_key: `reason.${reason_code}`, max_por_lote: MAX_POR_LOTE },
      { status },
    );
  }
}
