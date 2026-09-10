/**
 * POST /api/content/generate — formulário aciona o AGT-MKT-CONTENT.
 *
 * Não é uma capability nova nem um agente novo: é um segundo ponto de entrada
 * para o mesmo agente que já existe (`AGT-MKT-CONTENT`, CANDIDATE), no mesmo
 * loop de nove interfaces que `/api/agent` usa. A diferença é só o formato do
 * pedido — um formulário em vez de um chat — então esta rota monta o `text`
 * que o Resolver do loop já sabe interpretar, em vez de aceitar marca, canal
 * ou objetivo como IDs vindos do cliente.
 *
 * Isso importa porque o loop resolve entidades a partir de TEXTO, nunca de
 * IDs enviados prontos: um `brand_id` vindo do corpo do pedido pularia o
 * Resolver e a policy de tenant que o protegem. O formulário dá a marca pelo
 * NOME; quem decide qual `brand_id` isso é vira o Resolver, como em qualquer
 * outro pedido.
 *
 * `internal: true` é fixo aqui, não um campo do corpo — é esta rota que
 * decide que o pedido é para um agente CANDIDATE, não o cliente. O loop ainda
 * exige ACTOR_ROLE_FORBIDDEN != OWNER por baixo (MKT-09B §5); replicamos o
 * check aqui só para devolver a recusa sem gastar uma chamada ao modelo.
 */
import { NextRequest, NextResponse } from "next/server";
import { anthropic } from "@/lib/providers/anthropic";
import { getTrustedContext } from "@/lib/auth";
import { pool, ports } from "@/lib/db";
import { createWorkerApp } from "@olga/worker/composition";

export const runtime = "nodejs";

const { agentLoop } = createWorkerApp({ pool, providers: { anthropic } });

function montarTexto({ brand_name, objective, channel, briefing }: Record<string, string>) {
  const partes = [`Crie um conteúdo para a marca ${brand_name}.`];
  if (objective) partes.push(`Objetivo: ${objective}.`);
  if (channel) partes.push(`Canal: ${channel}.`);
  if (briefing) partes.push(`Briefing: ${briefing}`);
  return partes.join(" ");
}

export async function POST(request: NextRequest) {
  const ctx = await getTrustedContext({
    headers: request.headers,
    searchParams: request.nextUrl.searchParams,
  });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // AGT-MKT-CONTENT é CANDIDATE: roda com internal:true, que só OWNER pode
  // pedir (apps/web/app/api/agent/route.ts). Checar aqui evita chamar o
  // modelo para depois recusar por papel.
  if (ctx.role !== "OWNER") {
    return NextResponse.json(
      { reason_code: "ACTOR_ROLE_FORBIDDEN", message_key: "reason.ACTOR_ROLE_FORBIDDEN" },
      { status: 403 },
    );
  }
  if (!agentLoop) {
    return NextResponse.json(
      { reason_code: "PROVIDER_UNAVAILABLE", message_key: "reason.PROVIDER_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!body.brand_name) {
    return NextResponse.json(
      { reason_code: "SCHEMA_VALIDATION_FAILED", message_key: "reason.SCHEMA_VALIDATION_FAILED" },
      { status: 400 },
    );
  }

  // Gravado ANTES de chamar o loop, de propósito: se o processo cair no meio
  // da chamada ao modelo, o pedido continua rastreável (0011_content_briefs).
  // Sem isso, só sobreviveria o que desse certo — e é o que dá errado que
  // mais precisa de rastro.
  const brief_id = await ports.briefs.create({
    org_id: ctx.org_id, workspace_id: ctx.workspace_id,
    brand_name: body.brand_name, objective: body.objective ?? null,
    channel: body.channel || null, briefing: body.briefing ?? null,
    submitted_by_actor_id: ctx.user_id,
  });

  try {
    const { run_id, response } = await agentLoop.run({
      tenant: { org_id: ctx.org_id, workspace_id: ctx.workspace_id },
      actor: { id: ctx.user_id, role: ctx.role, org_id: ctx.org_id },
      agent_id: "AGT-MKT-CONTENT",
      input: { text: montarTexto(body) },
      facts: {},
      internal: true,
    });

    const content_version_id = response.respondability === "EXECUTABLE"
      ? await ports.knowledge.contentVersionByTrace(ctx.org_id, response.trace_id)
      : null;

    await ports.briefs.recordOutcome(brief_id, {
      trace_id: response.trace_id ?? null,
      run_id,
      content_version_id,
      reason_code: response.reason_codes?.[0] ?? null,
    });

    return NextResponse.json({ ...response, run_id });
  } catch (e: any) {
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    await ports.briefs.recordOutcome(brief_id, { reason_code });
    const status = reason_code === "TENANT_SCOPE_VIOLATION" ? 403
                 : reason_code === "ACTOR_ROLE_FORBIDDEN" ? 403
                 : reason_code === "SPEND_LIMIT_EXCEEDED" ? 402
                 : reason_code === "AGENT_NOT_ACTIVE" ? 409
                 : 503;
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
