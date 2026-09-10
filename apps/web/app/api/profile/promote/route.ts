/**
 * POST /api/profile/promote — promove uma versão CANDIDATE do perfil da empresa.
 *
 * O outro lado da recusa do agente. `proposeCompanyProfile` escreve
 * `'CANDIDATE'` como literal: não existe argumento que a faça escrever ACTIVE.
 * Sem esta rota, a proposta ficaria numa linha de banco que ninguém consegue
 * aceitar — foi o estado em que a promoção do Brand Brain esteve até a tela
 * `/brand` existir.
 *
 * Pesa mais que a promoção do Brand Brain, e por isso o mesmo cuidado com uma
 * exigência a mais: o perfil carrega produto, público e tom, e todo conteúdo
 * gerado depois herda os três.
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

  // Só OWNER. MARKETING escreve conteúdo; dizer quem a empresa é, o que ela
  // vende e para quem é outra coisa.
  if (ctx.role !== "OWNER") {
    return NextResponse.json(
      { reason_code: "ACTOR_ROLE_FORBIDDEN", message_key: "reason.ACTOR_ROLE_FORBIDDEN" },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  if (!body.brand_id || !body.version_id) {
    return NextResponse.json(
      { reason_code: "SCHEMA_VALIDATION_FAILED", message_key: "reason.SCHEMA_VALIDATION_FAILED" },
      { status: 400 },
    );
  }

  try {
    const r = await ports.governance.promoteCompanyProfile({
      org_id: ctx.org_id,
      brand_id: body.brand_id,
      version_id: body.version_id,
      // Quem promoveu vem do contexto confiável, nunca do corpo. Aceitar
      // `actor_id` de fora seria deixar alguém assinar em nome de outro
      // justamente no registro que existe para dizer quem assinou.
      actor_id: ctx.user_id,
      actor_type: "user",
    });
    return NextResponse.json(r);
  } catch (e: any) {
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = reason_code === "UNSUPPORTED_VALUE" ? 409
                 : reason_code === "NORMALIZATION_FAILED" ? 404
                 : reason_code === "ACTOR_ROLE_FORBIDDEN" ? 403
                 : 503;
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
