import { and, eq } from "drizzle-orm";
import { getRootDb } from "@/db";
import { calendarConnections, calendarSelections, calendarWatchChannels } from "@/db/schema";
import { decryptSecret } from "@/lib/crypto/secrets";
import { safeError } from "@/lib/safe-error";
import { freeBusy, refreshAccessToken, revokeToken, stopChannel, type GResult } from "./client";

export type Connection = typeof calendarConnections.$inferSelect;

// Token de acceso en memoria por conexión: dura ~1 h, no se guarda en la base.
const cache = new Map<string, { token: string; until: number }>();

export async function getConnection(orgId: string, userId: string): Promise<Connection | null> {
  const [c] = await getRootDb()
    .select()
    .from(calendarConnections)
    .where(and(eq(calendarConnections.organizationId, orgId), eq(calendarConnections.userId, userId)));
  return c ?? null;
}

async function markReauth(c: Connection, reason: string) {
  cache.delete(c.id);
  // Ante invalid_grant se frenan las escrituras externas de esta conexión hasta que la persona vuelva a conectar.
  await getRootDb()
    .update(calendarConnections)
    .set({ status: "reauth_required", lastError: reason.slice(0, 300), updatedAt: new Date() })
    .where(eq(calendarConnections.id, c.id))
    .catch(() => {});
}

export async function accessTokenFor(c: Connection): Promise<GResult<string>> {
  if (c.status !== "active") return { ok: false, error: "La conexión con Google necesita reconectarse", status: 0, reauth: true };
  const hit = cache.get(c.id);
  if (hit && hit.until > Date.now() + 60_000) return { ok: true, data: hit.token };
  const refresh = decryptSecret(c.refreshTokenEnc);
  if (!refresh) return { ok: false, error: "No se pudo descifrar la credencial (¿INTEGRATIONS_ENCRYPTION_KEY?)", status: 0 };
  const r = await refreshAccessToken(refresh);
  if (!r.ok) {
    if (r.reauth) await markReauth(c, r.error);
    return r;
  }
  cache.set(c.id, { token: r.data.access_token, until: Date.now() + r.data.expires_in * 1000 });
  return { ok: true, data: r.data.access_token };
}

export type ExternalBusy =
  | { status: "sin_conexion"; intervals: [] }
  | { status: "ok"; intervals: { start: Date; end: Date }[] }
  // Tiene Google conectado pero no se pudo leer: NO se ofrece el horario como libre.
  | { status: "no_verificable"; intervals: []; reason: string };

/** Ocupación personal del asesor en Google, solo intervalos (sin títulos, asistentes ni descripciones). */
export async function externalBusy(orgId: string, userId: string, from: Date, to: Date): Promise<ExternalBusy> {
  const c = await getConnection(orgId, userId);
  if (!c) return { status: "sin_conexion", intervals: [] };
  const sel = await getRootDb().select({ calendarId: calendarSelections.calendarId }).from(calendarSelections).where(eq(calendarSelections.connectionId, c.id));
  if (sel.length === 0) return { status: "ok", intervals: [] }; // conectó pero no eligió calendarios que bloqueen
  const token = await accessTokenFor(c);
  if (!token.ok) return { status: "no_verificable", intervals: [], reason: token.error };
  const r = await freeBusy(token.data, sel.map((s) => s.calendarId), from, to);
  if (!r.ok) return { status: "no_verificable", intervals: [], reason: r.error };
  return { status: "ok", intervals: r.data.map(({ start, end }) => ({ start, end })) };
}

/** Desconectar: revoca en Google, frena canales y borra credenciales. NO cierra la sesión ni borra visitas. */
export async function disconnect(orgId: string, userId: string) {
  const c = await getConnection(orgId, userId);
  if (!c) return;
  const db = getRootDb();
  const refresh = decryptSecret(c.refreshTokenEnc);
  try {
    const token = await accessTokenFor(c);
    if (token.ok) {
      const channels = await db.select().from(calendarWatchChannels).where(eq(calendarWatchChannels.connectionId, c.id));
      for (const ch of channels) if (ch.resourceId) await stopChannel(token.data, ch.channelId, ch.resourceId);
    }
  } catch (e) {
    console.error("[calendar] stop channels:", safeError(e));
  }
  if (refresh) await revokeToken(refresh);
  cache.delete(c.id);
  // La cascada borra selecciones, vínculos de eventos, jobs y canales de esta conexión.
  await db.delete(calendarConnections).where(eq(calendarConnections.id, c.id));
}
