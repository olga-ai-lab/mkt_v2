/**
 * POST /api/marketing/profile — o formulario de perfil do onboarding.
 *
 * E o passo que vem antes de gerar qualquer conteudo: a empresa declara
 * que tipo de operacao e, qual o objetivo comercial, em quais plataformas
 * publica, o que comunica e como comunica. Dessas respostas sai a escolha
 * do template de prompt (mkt.prompt_templates, migration 0012).
 *
 * ── O que esta rota NAO aceita ────────────────────────────────────────
 *
 * Tenant e ator vem da sessao, como em toda rota daqui. E o corpo nao
 * traz claim nenhum: o perfil nao afirma nada sobre cobertura, preco ou
 * prazo. Isso e do Brand Brain, que tem versao e promocao humana
 * exatamente porque decide o que pode ser afirmado.
 *
 * Os enums sao validados aqui contra a lista fechada em vez de irem
 * direto para o INSERT. O banco recusaria de todo jeito — os tipos sao
 * enums — mas recusaria com erro de tipo do Postgres vazando como se
 * fosse defeito nosso, em vez de um reason code que a tela sabe mostrar.
 */
import { NextRequest, NextResponse } from "next/server";
import { getTrustedContext } from "@/lib/auth";
import { ports } from "@/lib/db";

export const runtime = "nodejs";

const ORG_TYPES = ["CORRETORA", "CORRETOR_AUTONOMO", "ASSESSORIA", "SEGURADORA", "MGA", "BENEFICIOS"];
const OBJETIVOS = ["NOVOS_NEGOCIOS", "AUTORIDADE", "MARCA", "RELACIONAMENTO"];
const CANAIS = ["INSTAGRAM", "FACEBOOK", "LINKEDIN", "BLOG", "EMAIL", "WHATSAPP"];

const recusa = (reason_code: string, status: number) =>
  NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });

export async function POST(request: NextRequest) {
  const ctx = await getTrustedContext({
    headers: request.headers,
    searchParams: request.nextUrl.searchParams,
  });
  if (!ctx) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // Definir a estrategia da marca e ato de dono, como promover Brand Brain:
  // todo conteudo gerado depois herda esta escolha.
  if (ctx.role !== "OWNER") return recusa("ACTOR_ROLE_FORBIDDEN", 403);

  const body = await request.json().catch(() => ({}));
  const canais: string[] = Array.isArray(body.channels) ? body.channels : [];

  const valido =
    typeof body.brand_id === "string" && body.brand_id &&
    ORG_TYPES.includes(body.org_type) &&
    OBJETIVOS.includes(body.objective) &&
    canais.length > 0 && canais.every((c) => CANAIS.includes(c));

  if (!valido) return recusa("SCHEMA_VALIDATION_FAILED", 400);

  try {
    const id = await ports.marketing.saveProfile({
      org_id: ctx.org_id,
      workspace_id: ctx.workspace_id,
      brand_id: body.brand_id,
      org_type: body.org_type,
      objective: body.objective,
      channels: canais,
      o_que_comunica: body.o_que_comunica ?? null,
      como_comunica: body.como_comunica ?? null,
      publico_alvo: body.publico_alvo ?? null,
      actor_id: ctx.user_id,
    });
    return NextResponse.json({ profile_id: String(id) });
  } catch (e: any) {
    // FK violada = a marca nao e deste tenant (a RLS ja teria negado a
    // leitura dela). Nao devolvemos "nao existe": os dois casos sao o
    // mesmo para quem pergunta, e distinguir vazaria a existencia.
    if (e?.code === "23503" || e?.code === "23514") return recusa("SCHEMA_VALIDATION_FAILED", 400);
    return recusa("PROVIDER_UNAVAILABLE", 503);
  }
}
