/**
 * POST /api/publish — agenda a publicação de uma versão aprovada.
 *
 * É a origem do pipeline: `schedule()` grava a publicação, move o conteúdo e
 * deixa o pedido no outbox, tudo no mesmo commit. Daí em diante o relay e o
 * workflow durável assumem.
 *
 * Handler fino. A regra de "só publica o que está aprovado" não mora aqui e
 * nem no serviço: mora na state machine em trigger.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const ctx = await getTrustedContext({
    headers: request.headers,
    searchParams: request.nextUrl.searchParams,
  });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Só quem pode publicar. O gateway revalida no passo 2, mas recusar aqui
  // evita mover conteúdo para SCHEDULED por um pedido que ia ser barrado.
  if (ctx.role !== "OWNER" && ctx.role !== "MARKETING") {
    return NextResponse.json(
      { reason_code: "ACTOR_ROLE_FORBIDDEN", message_key: "reason.ACTOR_ROLE_FORBIDDEN" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));

  try {
    const r = await ports.publishing.schedule({
      org_id: ctx.org_id,
      workspace_id: ctx.workspace_id,
      content_version_id: body.content_version_id,
      channel: body.channel,
      connection_id: body.connection_id,
      channel_variant_id: body.channel_variant_id,
      approval_id: body.approval_id ?? null,
      autonomy_used: body.autonomy_used ?? null,
      trace_id: request.headers.get("x-trace-id"),
    });
    return NextResponse.json({ ...r, status: "SCHEDULED" });
  } catch (e: any) {
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = reason_code === "CONTENT_NOT_APPROVED" ? 409
                 : reason_code === "TENANT_SCOPE_VIOLATION" ? 403
                 : reason_code === "SCHEMA_VALIDATION_FAILED" ? 400
                 : 503;
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
