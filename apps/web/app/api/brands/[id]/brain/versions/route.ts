/**
 * POST /api/brands/:id/brain/versions — deriva uma nova candidata.
 *
 * Editar um Brand Brain nao muda a versao que existe: cria a proxima. O corpo
 * traz `from_version_id` e um `patch`, e o patch e validado contra
 * olga://io/brand-edit pelo servico — que e quem recusa `source_refs` e
 * `status`, porque nenhum dos dois se muda digitando.
 *
 * Handler fino, como os outros: quem decide roda em teste contra Postgres sem
 * passar por HTTP.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTrustedContext } from "@/lib/auth";
import { brandActivationService } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTrustedContext({ headers: request.headers, searchParams: request.nextUrl.searchParams });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const r = await brandActivationService.derive({
      tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
      brand_id: id,
      from_version_id: body.from_version_id,
      patch: body.patch ?? {},
      actor: { id: ctx.user_id, role: ctx.role },
      trace_id: request.headers.get("x-trace-id"),
    });

    return NextResponse.json({
      version: r.version.version,
      version_id: r.version.id,
      from_version: r.from.version,
      gaps: r.gaps,
    }, { status: 201 });
  } catch (e: any) {
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = e?.status ?? (reason_code === "TENANT_SCOPE_VIOLATION" ? 403 : 503);
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
