import { NextResponse } from "next/server";
import { accessTokenCookie, LoginError, signInWithPassword } from "@/lib/supabase-auth.mjs";

export async function POST(request: Request) {
  let input: unknown;
  try { input = await request.json(); }
  catch { return NextResponse.json({ message: "Pedido de login inválido." }, { status: 400 }); }

  try {
    const session = await signInWithPassword(input as { email: string; password: string });
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      ...accessTokenCookie(),
      value: session.accessToken,
      maxAge: Math.max(0, Math.floor(session.expiresIn)),
    });
    return response;
  } catch (error) {
    const known = error instanceof LoginError ? error : new LoginError("Não foi possível entrar agora.", 503);
    return NextResponse.json({ message: known.message }, { status: known.status });
  }
}
