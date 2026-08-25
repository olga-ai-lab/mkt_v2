import { NextResponse } from "next/server";
import { accessTokenCookie } from "@/lib/supabase-auth.mjs";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.set({ ...accessTokenCookie(), value: "", maxAge: 0 });
  return response;
}
