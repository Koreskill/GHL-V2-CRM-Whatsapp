import { and, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getRootDb } from "@/db";
import { calendarConnections, calendarOauthStates } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { REQUIRED_SCOPES, createSecondaryCalendar, emailFromIdToken, exchangeCode, sha256 } from "@/lib/calendar/google/client";
import { getConnection } from "@/lib/calendar/google/connections";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { requestOrigin } from "@/lib/request-origin";
import { safeError } from "@/lib/safe-error";

// Vuelta de Google. Valida: sesión vigente, `state` de un solo uso atado a ESTE usuario y organización,
// vencimiento y los scopes que Google concedió de verdad (la persona puede desmarcar casillas).
export async function GET(req: Request) {
  const origin = requestOrigin(req);
  const back = (q: string) => NextResponse.redirect(`${origin}/calendario/mi-calendario?${q}`);
  const session = await getSession();
  if (!session) return NextResponse.redirect(`${origin}/login`);
  if (session.actingAsClient) return back("error=agencia");

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") || !code || !state) return back("error=cancelado");

  const db = getRootDb();
  // Se consume el state ANTES de canjear: reutilizar el enlace no sirve.
  const [st] = await db
    .update(calendarOauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(calendarOauthStates.stateHash, sha256(state)), isNull(calendarOauthStates.usedAt)))
    .returning();
  if (!st || st.expiresAt.getTime() < Date.now() || st.userId !== session.user.id || st.organizationId !== session.organizationId) {
    return back("error=state");
  }
  const verifier = decryptSecret(st.codeVerifierEnc);
  if (!verifier) return back("error=config");

  const tokens = await exchangeCode(code, verifier, `${origin}/api/calendar/google/callback`);
  if (!tokens.ok) return back("error=google");

  const granted = (tokens.data.scope ?? "").split(" ");
  if (!REQUIRED_SCOPES.every((s) => granted.includes(s))) return back("error=permisos");

  // Google no siempre devuelve refresh token: si no vino, se conserva el anterior.
  const existing = await getConnection(session.organizationId, session.user.id);
  const refreshEnc = tokens.data.refresh_token ? encryptSecret(tokens.data.refresh_token) : existing?.refreshTokenEnc;
  if (!refreshEnc) return back("error=sin_refresh");

  const googleEmail = emailFromIdToken(tokens.data.id_token);
  const values = {
    organizationId: session.organizationId,
    userId: session.user.id,
    googleEmail,
    refreshTokenEnc: refreshEnc,
    scopes: granted,
    status: "active",
    lastError: null,
    updatedAt: new Date(),
  };
  const [conn] = await db
    .insert(calendarConnections)
    .values(values)
    .onConflictDoUpdate({ target: [calendarConnections.organizationId, calendarConnections.userId], set: values })
    .returning();

  // Calendario secundario para las visitas de GHL: no se mezcla con la agenda personal.
  if (!conn.destinationCalendarId && granted.includes("https://www.googleapis.com/auth/calendar.app.created")) {
    const cal = await createSecondaryCalendar(tokens.data.access_token, "Visitas (Setter CRM)", "America/Argentina/Buenos_Aires").catch((e) => {
      console.error("[calendar] crear secundario:", safeError(e));
      return null;
    });
    if (cal?.ok) await db.update(calendarConnections).set({ destinationCalendarId: cal.data.id }).where(eq(calendarConnections.id, conn.id));
  }
  return back("ok=conectado");
}
