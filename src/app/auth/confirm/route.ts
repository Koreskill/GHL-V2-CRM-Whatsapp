import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin } from "@/lib/request-origin";
import { createSupabaseServer } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["recovery", "email", "invite", "magiclink", "signup", "email_change"];

// Destino del enlace que manda Supabase por correo. Canjea el token_hash por una sesión y manda
// a la pantalla que corresponda. Nunca redirige fuera de la app: `next` tiene que ser una ruta interna.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const nextParam = searchParams.get("next") ?? "/";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const origin = requestOrigin(request);

  if (!tokenHash || !type || !TYPES.includes(type)) {
    return NextResponse.redirect(`${origin}/recuperar?error=vencido`);
  }

  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return NextResponse.redirect(`${origin}/recuperar?error=vencido`);

  return NextResponse.redirect(`${origin}${next}`);
}
