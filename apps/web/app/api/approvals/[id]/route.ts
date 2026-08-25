/**
 * POST /api/approvals/:id — registra a decisao.
 *
 * Handler fino: quem decide e o createApprovalService, que roda em teste
 * contra Postgres sem passar por HTTP. Aqui so tem tenant, traducao de erro
 * e status.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTrustedContext } from "@/lib/auth";
import { approvalService } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTrustedContext({ headers: request.headers, searchParams: request.nextUrl.searchParams });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const r = await approvalService.decide({
      tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
      approval_id: id,
      decision: body.decision,
      comment: body.comment ?? null,
      actor: { id: ctx.user_id, role: ctx.role },
      trace_id: request.headers.get("x-trace-id"),
    });

    // Decidido por outra aba enquanto esta estava aberta. Nao e erro: e estado
    // que a tela precisa refletir, entao devolvemos 409 com o estado atual.
    if (r.already_decided) {
      return NextResponse.json(
        { decision: r.approval.decision, already_decided: true, message_key: "approval.already_decided" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      decision: r.approval.decision,
      decided_at: r.approval.decided_at,
      content_state: r.content?.state ?? null,
    });
  } catch (e: any) {
    // INVALID_STATE_TRANSITION vem do trigger: o conteudo saiu de revisao
    // debaixo de quem estava decidindo.
    if (String(e?.message ?? "").includes("INVALID_STATE_TRANSITION")) {
      return NextResponse.json(
        { reason_code: "CONTENT_NOT_APPROVED", message_key: "reason.CONTENT_NOT_APPROVED" },
        { status: 409 },
      );
    }
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = reason_code === "TENANT_SCOPE_VIOLATION" ? 403
                 : reason_code === "SCHEMA_VALIDATION_FAILED" ? 400
                 : reason_code === "CONTENT_NOT_APPROVED" ? 409
                 : 503;
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
