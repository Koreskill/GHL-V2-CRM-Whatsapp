"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getRootDb } from "@/db";
import { calendarSelections } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { accessTokenFor, disconnect, getConnection } from "@/lib/calendar/google/connections";
import { listCalendars } from "@/lib/calendar/google/client";

const BASE = "/calendario/mi-calendario";

async function ownSession() {
  const s = await getSession();
  if (!s) redirect("/login");
  // Un calendario personal solo lo gestiona su dueño: el modo agencia no usa credenciales de otra persona.
  if (s.actingAsClient) redirect(`${BASE}?error=agencia`);
  return s;
}

// Qué calendarios bloquean disponibilidad. Los ids se validan contra la lista REAL de Google del usuario.
export async function saveSelectionsAction(formData: FormData) {
  const s = await ownSession();
  const conn = await getConnection(s.organizationId, s.user.id);
  if (!conn) redirect(BASE);
  const token = await accessTokenFor(conn);
  if (!token.ok) redirect(`${BASE}?error=google`);
  const cals = await listCalendars(token.data);
  if (!cals.ok) redirect(`${BASE}?error=google`);

  const wanted = new Set(formData.getAll("calendar").map(String));
  const valid = cals.data.filter((c) => wanted.has(c.id));
  const db = getRootDb();
  await db.delete(calendarSelections).where(eq(calendarSelections.connectionId, conn.id));
  if (valid.length) {
    await db.insert(calendarSelections).values(valid.map((c) => ({ organizationId: s.organizationId, connectionId: conn.id, calendarId: c.id, summary: c.summary.slice(0, 200) })));
  }
  revalidatePath(BASE);
  redirect(`${BASE}?ok=guardado`);
}

export async function disconnectAction() {
  const s = await ownSession();
  await disconnect(s.organizationId, s.user.id);
  revalidatePath(BASE);
  redirect(`${BASE}?ok=desconectado`);
}
