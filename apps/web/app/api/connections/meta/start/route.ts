/**
 * GET /api/connections/meta/start — manda a pessoa para a tela da Meta.
 *
 * Este é o passo do consentimento, e ele não passa pelo Capability Gateway de
 * propósito: o gateway media o efeito de uma capability sobre uma conexão que
 * já existe. Aqui não há conexão ainda, e quem age é a pessoa no navegador
 * dela, na tela da Meta. Fazer isso passar pelo gateway daria ao agente um
 * caminho para conectar contas, que é exatamente o que `channel.connect` não
 * estar no charter de nenhum agente significa.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTrustedContext } from "@/lib/auth";
import { configMeta } from "@/lib/meta";
import { assinarEstado, urlDeAutorizacao } from "@olga/runtime/meta-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const ctx = await getTrustedContext({
    headers: request.headers,
    searchParams: request.nextUrl.searchParams,
  });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Só OWNER. Conectar uma conta é dar ao produto permissão de publicar em nome
  // do cliente; é a mesma classe de decisão que promover o Brand Brain.
  if (ctx.role !== "OWNER") {
    return NextResponse.json(
      { reason_code: "ACTOR_ROLE_FORBIDDEN", message_key: "reason.ACTOR_ROLE_FORBIDDEN" },
      { status: 403 },
    );
  }

  const cfg = configMeta();
  if ("faltando" in cfg) {
    return NextResponse.json(
      { reason_code: "PROVIDER_UNAVAILABLE", message_key: "reason.PROVIDER_UNAVAILABLE",
        faltando: cfg.faltando },
      { status: 503 },
    );
  }

  // O tenant viaja assinado no `state`. O callback não vai ter sessão garantida
  // — a Meta redireciona de fora — e sem isso ele teria de confiar num
  // parâmetro de URL para saber em qual workspace gravar.
  const state = assinarEstado({
    org_id: ctx.org_id, workspace_id: ctx.workspace_id, user_id: ctx.user_id,
    app_secret: cfg.config.app_secret,
  });

  return NextResponse.redirect(
    urlDeAutorizacao({ app_id: cfg.config.app_id, redirect_uri: cfg.config.redirect_uri, state }));
}
