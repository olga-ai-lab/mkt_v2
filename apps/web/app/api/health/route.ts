/**
 * GET /api/health — o healthcheck que o Railway consulta (ADR-0012).
 *
 * Handler fino: a decisão mora em `lib/health.mjs`, que roda em teste sem
 * subir o Next. É a mesma divisão de `lib/auth.ts` com `lib/session.mjs`.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { verificarSaude } from "@/lib/health.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { codigo, corpo } = await verificarSaude(pool, { schema: process.env.MKT_SCHEMA });
  return NextResponse.json(corpo, { status: codigo });
}
