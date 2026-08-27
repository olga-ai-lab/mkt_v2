/**
 * A superfície de contenção de incidente.
 *
 *   GET  /api/containment   o que está contido agora, por quem e desde quando
 *   POST /api/containment   contém ou levanta
 *
 * Existe porque durante um incidente ninguém escreve uma migration. A diferença
 * entre conter em trinta segundos e conter em trinta minutos é o número de
 * posts que saíram no meio.
 *
 * Handler fino, como os outros: quem decide é o createContainmentService, que
 * roda em teste contra Postgres sem passar por HTTP. O runbook está em
 * docs/runbooks/conter-incidente.md.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTrustedContext } from "@/lib/auth";
import { containmentService } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await getTrustedContext({ headers: request.headers, searchParams: request.nextUrl.searchParams });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const contido = await containmentService.list({
    tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
  });
  return NextResponse.json({ contido });
}

export async function POST(request: NextRequest) {
  const ctx = await getTrustedContext({ headers: request.headers, searchParams: request.nextUrl.searchParams });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const tenant = { org_id: ctx.org_id, workspace_id: ctx.workspace_id };
  const actor = { id: ctx.user_id, role: ctx.role };
  const comum = { tenant, actor, reason: body.reason, expires_at: body.expires_at ?? null,
                  trace_id: request.headers.get("x-trace-id") };

  try {
    switch (body.action) {
      case "kill_writes":
        return NextResponse.json(await containmentService.killWrites(comum), { status: 201 });
      case "kill_agent":
        return NextResponse.json(
          await containmentService.killAgent({ ...comum, agent_id: body.agent_id }), { status: 201 });
      case "kill_capability":
        return NextResponse.json(
          await containmentService.killCapability({ ...comum, capability_id: body.capability_id }),
          { status: 201 });
      case "degrade_agent":
        return NextResponse.json(
          await containmentService.degradeAgent({ ...comum, agent_id: body.agent_id }), { status: 201 });
      case "lift":
        return NextResponse.json(
          await containmentService.lift({ tenant, actor, policy_id: body.policy_id,
                                          reason: body.reason,
                                          trace_id: request.headers.get("x-trace-id") }));
      default:
        // Ação desconhecida não vira a mais permissiva por engano.
        return NextResponse.json(
          { reason_code: "UNSUPPORTED_VALUE", message_key: "reason.UNSUPPORTED_VALUE" },
          { status: 400 });
    }
  } catch (e: any) {
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = e?.status ?? 503;
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
