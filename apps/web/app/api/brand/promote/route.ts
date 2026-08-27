/**
 * POST /api/brand/promote — promove uma versão CANDIDATE do Brand Brain.
 *
 * É o ato de governança que o AGT-MKT-BRAND declara não praticar: ele propõe,
 * uma pessoa promove. O `deviates_from_base` dele no registry diz isso com
 * todas as letras, e a porta `proposeBrandVersion` escreve `'CANDIDATE'` como
 * literal — não existe argumento que a faça escrever ACTIVE.
 *
 * Esta rota é o outro lado daquela recusa. Sem ela, a proposta ficaria numa
 * linha de banco que ninguém consegue aceitar.
 *
 * Handler fino, como os outros: a regra de "só promove CANDIDATE" e o
 * rebaixamento da ACTIVE anterior moram na porta, numa transação só.
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

  // Só OWNER. MARKETING publica conteúdo; mudar o que a marca AFIRMA sobre si
  // mesma é outra coisa — todo conteúdo gerado depois herda esta decisão.
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
    const r = await ports.governance.promoteBrandVersion({
      org_id: ctx.org_id,
      brand_id: body.brand_id,
      version_id: body.version_id,
      // Quem promoveu vem do contexto confiável, nunca do corpo do pedido.
      // Aceitar `actor_id` de fora seria deixar alguém assinar em nome de
      // outro justamente no registro que existe para dizer quem assinou.
      actor_id: ctx.user_id,
      actor_type: "user",
    });
    return NextResponse.json(r);
  } catch (e: any) {
    const reason_code = e?.reason_code ?? "PROVIDER_UNAVAILABLE";
    const status = reason_code === "UNSUPPORTED_VALUE" ? 409
                 : reason_code === "NORMALIZATION_FAILED" ? 404
                 : reason_code === "TENANT_SCOPE_VIOLATION" ? 403
                 : 503;
    return NextResponse.json({ reason_code, message_key: `reason.${reason_code}` }, { status });
  }
}
