"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { availabilityBlocks, availabilityRules, calendarSettings } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { wallTimeToDate } from "@/lib/tz";

const BASE = "/calendario/disponibilidad";
const text = (f: FormData, k: string, max = 200) => String(f.get(k) ?? "").trim().slice(0, max);
const fail = (m: string): never => redirect(`${BASE}?error=${encodeURIComponent(m)}`);

async function session() {
  const s = await getSession();
  if (!s) redirect("/login");
  // En modo agencia no se editan reglas personales de otro: cada asesor define las suyas.
  return s;
}

const int = (f: FormData, k: string, min: number, max: number) => {
  const n = Number(text(f, k, 8));
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

const bumpVersion = async (orgId: string) => {
  await getDb().update(calendarSettings).set({ rulesVersion: sql`${calendarSettings.rulesVersion} + 1`, updatedAt: new Date() }).where(eq(calendarSettings.organizationId, orgId));
};

// Política de la inmobiliaria (solo administradores). Sin las cuatro cifras no se puede activar: no hay defaults.
export async function saveSettingsAction(formData: FormData) {
  const s = await session();
  if (s.role !== "admin") fail("Solo un administrador puede cambiar la política.");
  const enabled = text(formData, "enabled") === "1";
  const provider = text(formData, "provider") === "internal" ? "internal" : "calcom";
  const durationMin = int(formData, "durationMin", 10, 480);
  const bufferMin = int(formData, "bufferMin", 0, 240);
  const minNoticeMin = int(formData, "minNoticeMin", 0, 60 * 24 * 14);
  const horizonDays = int(formData, "horizonDays", 1, 180);
  const complete = durationMin !== null && bufferMin !== null && minNoticeMin !== null && horizonDays !== null;
  if (enabled && !complete) fail("Para activarlo completa duración, traslado, anticipación y horizonte.");
  if (provider === "internal" && !enabled) fail("Para usar el calendario interno como gestor, actívalo.");

  await getDb()
    .insert(calendarSettings)
    .values({ organizationId: s.organizationId, enabled, provider, durationMin, bufferMin, minNoticeMin, horizonDays })
    .onConflictDoUpdate({
      target: calendarSettings.organizationId,
      set: { enabled, provider, durationMin, bufferMin, minNoticeMin, horizonDays, rulesVersion: sql`${calendarSettings.rulesVersion} + 1`, updatedAt: new Date() },
    });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=guardado`);
}

const toMin = (hhmm: string) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export async function addRuleAction(formData: FormData) {
  const s = await session();
  const weekday = int(formData, "weekday", 0, 6);
  const start = toMin(text(formData, "start", 5));
  const end = toMin(text(formData, "end", 5));
  if (weekday === null || start === null || end === null || end <= start || end > 1440) fail("Revisa el día y el horario.");
  await getDb().insert(availabilityRules).values({ organizationId: s.organizationId, userId: s.user.id, weekday: weekday!, startMin: start!, endMin: end! });
  await bumpVersion(s.organizationId);
  revalidatePath(BASE);
  redirect(`${BASE}?ok=franja`);
}

export async function deleteRuleAction(formData: FormData) {
  const s = await session();
  const id = text(formData, "id", 64);
  if (!isUuid(id)) redirect(BASE);
  await getDb().delete(availabilityRules).where(and(eq(availabilityRules.id, id), eq(availabilityRules.organizationId, s.organizationId), eq(availabilityRules.userId, s.user.id)));
  await bumpVersion(s.organizationId);
  revalidatePath(BASE);
  redirect(BASE);
}

export async function addBlockAction(formData: FormData) {
  const s = await session();
  const start = wallTimeToDate(text(formData, "startsAt", 40));
  const end = wallTimeToDate(text(formData, "endsAt", 40));
  if (!start || !end || end <= start) fail("Revisa las fechas del bloqueo.");
  const wholeOrg = text(formData, "scope") === "org";
  if (wholeOrg && s.role !== "admin") fail("Solo un administrador bloquea toda la inmobiliaria.");
  await getDb().insert(availabilityBlocks).values({
    organizationId: s.organizationId,
    userId: wholeOrg ? null : s.user.id,
    startsAt: start!,
    endsAt: end!,
    reason: text(formData, "reason", 200) || null,
  });
  revalidatePath(BASE);
  redirect(`${BASE}?ok=bloqueo`);
}

export async function deleteBlockAction(formData: FormData) {
  const s = await session();
  const id = text(formData, "id", 64);
  if (!isUuid(id)) redirect(BASE);
  const own = s.role === "admin" ? undefined : eq(availabilityBlocks.userId, s.user.id);
  await getDb().delete(availabilityBlocks).where(and(eq(availabilityBlocks.id, id), eq(availabilityBlocks.organizationId, s.organizationId), own));
  revalidatePath(BASE);
  redirect(BASE);
}
