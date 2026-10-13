import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getRootDb } from "@/db";
import { calendarOauthStates } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { buildAuthUrl, googleCalendarConfigured, newPkce, sha256 } from "@/lib/calendar/google/client";
import { encryptSecret, encryptionConfigured } from "@/lib/crypto/secrets";
import { rateLimit } from "@/lib/rate-limit";
import { requestOrigin } from "@/lib/request-origin";

// Inicia "Conectar Google Calendar". Es una autorización PERSONAL y distinta del login con Google:
// solo la puede iniciar el propio usuario con su sesión, y nunca desde el modo agencia (un admin de la
// agencia no autoriza el calendario de otra persona ni usa sus credenciales).
export async function GET(req: Request) {
  const session = await getSession();
  const origin = requestOrigin(req);
  if (!session) return NextResponse.redirect(`${origin}/login`);
  const back = (q: string) => NextResponse.redirect(`${origin}/calendario/mi-calendario?${q}`);

  if (session.actingAsClient) return back("error=agencia");
  if (!googleCalendarConfigured() || !encryptionConfigured()) return back("error=config");
  if (!rateLimit(`gcal-connect:${session.user.id}`, 10, 15 * 60_000).ok) return back("error=limite");

  const state = randomBytes(32).toString("base64url");
  const { verifier, challenge } = newPkce();
  await getRootDb().insert(calendarOauthStates).values({
    stateHash: sha256(state),
    organizationId: session.organizationId,
    userId: session.user.id,
    codeVerifierEnc: encryptSecret(verifier),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return NextResponse.redirect(buildAuthUrl({ redirectUri: `${origin}/api/calendar/google/callback`, state, challenge, loginHint: session.email }));
}
