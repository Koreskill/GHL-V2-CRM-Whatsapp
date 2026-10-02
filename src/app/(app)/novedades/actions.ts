"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { networks, newsEvents, organizations } from "@/db/schema";
import { writeAudit } from "@/lib/agency/queries";
import { isUuid } from "@/lib/api";
import { requireAgencyAdmin } from "@/lib/auth";
import { parseEventInput } from "@/lib/news/input";
import { canManage } from "@/lib/news/logic";
import { getVisibleEvent, viewerFor } from "@/lib/news/queries";

// Crear, editar y borrar eventos: solo el equipo interno (administradores de la agencia). La
// validación es del servidor: esconder el botón no es la protección.

async function adminOrRedirect() {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/novedades");
  const viewer = await viewerFor(session);
  if (!canManage(viewer)) redirect("/novedades");
  return { session, viewer };
}

// El destino tiene que existir: una red real o un cliente real.
async function targetError(input: { networkId: string | null; organizationId: string | null }): Promise<string | null> {
  const db = getDb();
  if (input.networkId) {
    const [n] = await db.select({ id: networks.id }).from(networks).where(eq(networks.id, input.networkId));
    if (!n) return "La red no existe.";
  }
  if (input.organizationId) {
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, input.organizationId));
    if (!o) return "El cliente no existe.";
  }
  return null;
}

export async function createNewsEvent(formData: FormData) {
  const { session } = await adminOrRedirect();
  const parsed = parseEventInput((k) => formData.get(k));
  if (!parsed.ok) redirect(`/novedades/nuevo?error=${encodeURIComponent(parsed.error)}`);
  const bad = await targetError(parsed.value);
  if (bad) redirect(`/novedades/nuevo?error=${encodeURIComponent(bad)}`);

  const [row] = await getDb()
    .insert(newsEvents)
    .values({ ...parsed.value, createdBy: session.user.id })
    .returning({ id: newsEvents.id });
  await writeAudit({ actorUserId: session.user.id, action: "news.create", target: row.id, metadata: { scope: parsed.value.scope } });
  revalidatePath("/novedades");
  revalidatePath("/");
  redirect(`/novedades/${row.id}`);
}

export async function updateNewsEvent(formData: FormData) {
  const { session, viewer } = await adminOrRedirect();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/novedades");
  if (!(await getVisibleEvent(viewer, id))) redirect("/novedades");

  const parsed = parseEventInput((k) => formData.get(k));
  if (!parsed.ok) redirect(`/novedades/${id}?error=${encodeURIComponent(parsed.error)}`);
  const bad = await targetError(parsed.value);
  if (bad) redirect(`/novedades/${id}?error=${encodeURIComponent(bad)}`);

  await getDb()
    .update(newsEvents)
    .set({ ...parsed.value, updatedAt: sql`now()` })
    .where(eq(newsEvents.id, id));
  await writeAudit({ actorUserId: session.user.id, action: "news.update", target: id });
  revalidatePath("/novedades");
  revalidatePath("/");
  redirect(`/novedades/${id}?guardado=1`);
}

export async function deleteNewsEvent(formData: FormData) {
  const { session, viewer } = await adminOrRedirect();
  const id = String(formData.get("id") ?? "");
  if (!isUuid(id)) redirect("/novedades");
  if (await getVisibleEvent(viewer, id)) {
    await getDb().delete(newsEvents).where(eq(newsEvents.id, id));
    await writeAudit({ actorUserId: session.user.id, action: "news.delete", target: id });
  }
  revalidatePath("/novedades");
  revalidatePath("/");
  redirect("/novedades?eliminado=1");
}
