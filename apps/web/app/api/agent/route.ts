/**
 * POST /api/agent — entrada unica do runtime de agentes.
 *
 * O que esta rota faz de mais importante e o que ela NAO aceita:
 * o corpo do pedido nunca escolhe organizacao, workspace ou papel. Isso vem
 * da sessao autenticada e e revalidado no servidor (MKT-09B §5).
 *
 * Handler fino de proposito: a decisao vive no runtime, que e testavel sem HTTP.
 */
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { createModelGateway, createAgentRuntime } from "@olga/runtime";
import { createPostgresPorts } from "@olga/runtime/ports-postgres";
import { anthropic } from "@/lib/providers/anthropic";
import { getTrustedContext } from "@/lib/auth";

export const runtime = "nodejs";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ports = createPostgresPorts(pool);

const modelGateway = createModelGateway({
  routing: ports.routing,
  budget: ports.budget,
  providers: { anthropic },
  tracer: { event: (e) => console.log(JSON.stringify({ ...e, kind: "trace" })) },
});

const agentRuntime = createAgentRuntime({
  modelGateway,
  registry: ports.registry,
  runs: ports.runs,
  tracer: { event: (e) => console.log(JSON.stringify({ ...e, kind: "trace" })) },
  ids: { newId: () => crypto.randomUUID(), newTraceId: () => `tr_${crypto.randomUUID()}` },
});

export async function POST(request: NextRequest) {
  // Tenant e ator vem da sessao. Se o corpo trouxer, o runtime recusa.
  const ctx = await getTrustedContext(request);
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await request.json();

  try {
    const { run_id, trace_id, response, model } = await agentRuntime.run({
      tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
      actor: { id: ctx.user_id, role: ctx.role, org_id: ctx.org_id },
      agent_id: body.agent_id,
      input: { text: body.text },
      requested_autonomy: body.requested_autonomy,
      internal: ctx.role === "OWNER" && body.internal === true,
    });

    return NextResponse.json({
      run_id, trace_id, ...response,
      usage: { cost_cents: model.cost_cents, input_tokens: model.input_tokens,
               output_tokens: model.output_tokens, fallback_used: model.fallback_used },
    });
  } catch (e: any) {
    // O usuario ve a microcopy do reason code, nunca a mensagem tecnica.
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = reason_code === "TENANT_SCOPE_VIOLATION" ? 403
                 : reason_code === "SPEND_LIMIT_EXCEEDED" ? 402
                 : reason_code === "AGENT_NOT_ACTIVE" ? 409
                 : 503;
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
