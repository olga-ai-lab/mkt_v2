/**
 * POST /api/brands/:id/brain/:versionId/activate
 *
 * O ato humano em que o onboarding termina. Handler fino de proposito: quem
 * decide e o createBrandActivationService, que roda em teste contra Postgres
 * sem passar por HTTP. Aqui so tem tenant, traducao de erro e status.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTrustedContext } from "@/lib/auth";
import { brandActivationService } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const ctx = await getTrustedContext({ headers: request.headers, searchParams: request.nextUrl.searchParams });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id, versionId } = await params;

  try {
    const r = await brandActivationService.activate({
      tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
      brand_id: id,
      version_id: versionId,
      actor: { id: ctx.user_id, role: ctx.role },
      trace_id: request.headers.get("x-trace-id"),
    });

    // Ativada por outra aba enquanto esta estava aberta. Nao e erro: e estado
    // que a tela precisa refletir.
    if (r.already_active) {
      return NextResponse.json(
        { already_active: true, version: r.version.version, message_key: "brand.already_active" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      version: r.version.version,
      activated_at: r.version.activated_at,
      replaced_version: r.replaced?.version ?? null,
      reverted: r.reverted,
      // As lacunas viajam na resposta porque a tela precisa dize-las na hora:
      // uma marca sem proibicoes passa pelo compliance sem nada a conferir, e
      // quem acabou de ativar e quem pode resolver isso.
      gaps: r.gaps,
    });
  } catch (e: any) {
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = e?.status ?? (reason_code === "TENANT_SCOPE_VIOLATION" ? 403 : 503);
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
