/**
 * GET /api/approvals — a fila de decisoes pendentes do workspace da sessao.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTrustedContext } from "@/lib/auth";
import { approvalService } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await getTrustedContext({ headers: request.headers, searchParams: request.nextUrl.searchParams });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const fila = await approvalService.listPending({
    org_id: ctx.org_id, workspace_id: ctx.workspace_id,
  });

  // O corpo do conteudo nao vai inteiro para a lista: a tela mostra o texto na
  // hora de decidir, e mandar tudo na listagem so aumenta o que vaza num log.
  return NextResponse.json({
    items: fila.map((p: any) => ({
      approval_id: p.approval.id,
      subject_id: p.approval.subject_id,
      subject_version: p.approval.subject_version,
      requested_reason_codes: p.approval.requested_reason_codes,
      created_at: p.approval.created_at,
      content: p.content && {
        id: p.content.id,
        version: p.content.version,
        state: p.content.state,
        risk_tier: p.content.risk_tier,
        master_body: p.content.master_body,
      },
    })),
  });
}
