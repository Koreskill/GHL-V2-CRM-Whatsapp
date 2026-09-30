"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { contactViews } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { contactFiltersToParams, parseContactFilters } from "@/lib/crm/contact-filters";
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
