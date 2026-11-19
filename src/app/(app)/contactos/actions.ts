"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { contactViews } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { contactFiltersToParams, parseContactFilters } from "@/lib/crm/contact-filters";
import {
  contactIdsMatching,
  deleteGroup,
  deleteLabel,
  saveGroup,
  saveLabel,
  setGroupMembership,
  setLabel,
  setOptOut,
} from "@/lib/crm/groups";
import { authorizeAction } from "@/lib/deals/guard";

const text = (form: FormData, key: string, max = 100) => String(form.get(key) ?? "").trim().slice(0, max);

export async function saveContactView(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const name = text(formData, "name", 60);
  // Se vuelve a parsear: lo guardado es lo que el servidor entiende, no el texto crudo del formulario.
  const params = contactFiltersToParams(parseContactFilters(Object.fromEntries(new URLSearchParams(text(formData, "f", 2000)))));
  if (!name) redirect(`/contactos?${params.toString()}`);

  await getDb().insert(contactViews).values({
    organizationId: orgId,
    ownerUserId: session.user.id,
    name,
    filters: Object.fromEntries(params),
    shared: formData.get("shared") === "on" && session.role === "admin",
  });
  revalidatePath("/contactos");
  redirect(`/contactos?${params.toString()}`);
}

// Solo quien la creó puede borrarla.
export async function deleteContactView(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const id = text(formData, "id", 64);
  if (isUuid(id)) {
    await getDb()
      .delete(contactViews)
      .where(and(eq(contactViews.id, id), eq(contactViews.organizationId, orgId), eq(contactViews.ownerUserId, session.user.id)));
  }
  revalidatePath("/contactos");
  redirect("/contactos");
}

// ── Acciones en bloque sobre contactos ──────────────────────────────────────
// `op` = "label:add:<id>" | "label:remove:<id>" | "group:add:<id>" | "group:remove:<id>" | "optout:on" | "optout:off".
// Alcance: los tildados (`ids`) o, con scope=all, todos los que cumplen el filtro (tope 1000).
// Los ids se validan contra la organización en lib/crm/groups.ts: uno ajeno no hace nada.
export async function bulkContactsAction(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const qs = text(formData, "f", 2000);
  const back = (msg: string): never => {
    revalidatePath("/contactos");
    redirect(`/contactos?${qs}${qs ? "&" : ""}aviso=${encodeURIComponent(msg)}`);
  };
  const [kind, verb, targetId] = text(formData, "op", 100).split(":");
  const ids =
    formData.get("scope") === "all"
      ? await contactIdsMatching(orgId, parseContactFilters(Object.fromEntries(new URLSearchParams(qs))))
      : formData.getAll("ids").map(String).filter(isUuid);
  if (!ids.length) back("No hay contactos seleccionados.");

  let res: { ok: true; changed: number } | { ok: false; error: string };
  if (kind === "label" && isUuid(targetId)) res = await setLabel(orgId, session.user.id, targetId, ids, verb === "add");
  else if (kind === "group" && isUuid(targetId)) res = await setGroupMembership(orgId, session.user.id, targetId, ids, verb === "add");
  else if (kind === "optout") res = await setOptOut(orgId, ids, verb === "on");
  else return back("Elegí qué hacer con los seleccionados.");
  back(res.ok ? `Listo: ${res.changed} ${res.changed === 1 ? "contacto actualizado" : "contactos actualizados"}.` : res.error);
}

// ── Grupos y etiquetas ──────────────────────────────────────────────────────
// Crear y editar: cualquier persona del equipo. Borrar: solo admin (borra las asignaciones, nunca contactos).

const ORGANIZE = "/contactos/organizar";
const backOrganize = (msg?: string, error?: string): never => {
  revalidatePath(ORGANIZE);
  revalidatePath("/contactos");
  const p = new URLSearchParams();
  if (msg) p.set("ok", msg);
  if (error) p.set("error", error);
  redirect(`${ORGANIZE}${p.size ? `?${p}` : ""}`);
};

export async function saveLabelAction(formData: FormData) {
  const { orgId } = await authorizeAction();
  const id = text(formData, "id", 64);
  const res = await saveLabel(orgId, { id: isUuid(id) ? id : undefined, name: text(formData, "name", 40), color: text(formData, "color", 20) });
  backOrganize(res.ok ? "Etiqueta guardada." : undefined, res.ok ? undefined : res.error);
}

export async function deleteLabelAction(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  if (session.role !== "admin") backOrganize(undefined, "Solo un administrador puede borrar etiquetas.");
  const id = text(formData, "id", 64);
  if (isUuid(id)) await deleteLabel(orgId, id);
  backOrganize("Etiqueta borrada. Los contactos siguen intactos.");
}

export async function saveGroupAction(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const id = text(formData, "id", 64);
  const res = await saveGroup(orgId, session.user.id, { id: isUuid(id) ? id : undefined, name: text(formData, "name", 60), description: text(formData, "description", 300) });
  backOrganize(res.ok ? "Grupo guardado." : undefined, res.ok ? undefined : res.error);
}

export async function deleteGroupAction(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  if (session.role !== "admin") backOrganize(undefined, "Solo un administrador puede borrar grupos.");
  const id = text(formData, "id", 64);
  if (isUuid(id)) await deleteGroup(orgId, id);
  backOrganize("Grupo borrado. Los contactos siguen intactos.");
}
