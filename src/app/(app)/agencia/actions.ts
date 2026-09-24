"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createOrganization, slugTaken, writeAudit } from "@/lib/agency/queries";
import { createClientUser, deleteClientUser, setUserPassword } from "@/lib/agency/users";
import { toSlug } from "@/lib/agency/slug";
import { requireAgencyAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/api";
import { hasAdminKey } from "@/lib/supabase/admin";

const MAX = 320;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const field = (form: FormData, key: string) => String(form.get(key) ?? "").trim().slice(0, MAX);

function fail(path: string, motivo: string): never {
  redirect(`${path}?error=${encodeURIComponent(motivo)}`);
}

// Alta de cliente: crea la inmobiliaria y su primer usuario administrador en un solo paso.
// La contraseña la elige (o genera) el dueño de la agencia en el formulario y se la pasa al cliente:
// nunca vuelve por la URL ni queda en un log.
export async function createClient(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  if (!hasAdminKey()) fail("/agencia/nuevo", "Falta SUPABASE_SECRET_KEY en el servidor: sin esa clave no se pueden crear usuarios.");

  const name = field(formData, "name");
  const slug = toSlug(field(formData, "slug") || name);
  const email = field(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = field(formData, "fullName") || null;

  if (name.length < 2) fail("/agencia/nuevo", "Escribe el nombre de la inmobiliaria.");
  if (slug.length < 2) fail("/agencia/nuevo", "El identificador tiene que tener al menos 2 caracteres.");
  if (!EMAIL_RE.test(email)) fail("/agencia/nuevo", "El email del administrador no es válido.");
  if (password.length < 10) fail("/agencia/nuevo", "La contraseña tiene que tener al menos 10 caracteres.");
  if (await slugTaken(slug)) fail("/agencia/nuevo", `Ya existe un cliente con el identificador "${slug}".`);

  const org = await createOrganization({ name, slug });
  const created = await createClientUser({
    email,
    password,
    organizationId: org.id,
    role: "admin",
    fullName,
  });

  if ("error" in created) {
    // La organización quedó creada pero sin usuario: se avisa en vez de dejar un alta a medias en silencio.
    await writeAudit({
      actorUserId: session.user.id,
      actingAsOrganizationId: org.id,
      action: "client_create_failed",
      target: `organization:${org.id}`,
      metadata: { reason: "auth_user" },
    });
    fail("/agencia/nuevo", `Se creó la inmobiliaria pero no el usuario: ${created.error}. Agrégalo desde su ficha.`);
  }

  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: org.id,
    action: "client_created",
    target: `organization:${org.id}`,
    metadata: { slug, adminUserId: created.id },
  });

  revalidatePath("/agencia");
  redirect(`/agencia/${org.id}?creado=1`);
}

// Usuario adicional dentro de un cliente ya existente.
export async function addClientUser(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  if (!isUuid(orgId)) redirect("/agencia");
  const back = `/agencia/${orgId}`;
  if (!hasAdminKey()) fail(back, "Falta SUPABASE_SECRET_KEY en el servidor.");

  const email = field(formData, "email").toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = formData.get("role") === "admin" ? "admin" : "agent";
  if (!EMAIL_RE.test(email)) fail(back, "El email no es válido.");
  if (password.length < 10) fail(back, "La contraseña tiene que tener al menos 10 caracteres.");

  const created = await createClientUser({ email, password, organizationId: orgId, role });
  if ("error" in created) fail(back, created.error);

  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "user_created",
    target: `user:${created.id}`,
    metadata: { role },
  });
  revalidatePath(back);
  redirect(`${back}?usuario=creado`);
}

// Reseteo de contraseña por el dueño de la agencia, para cuando el cliente la pierde y no
// puede usar el correo de recuperación.
export async function resetClientPassword(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  const userId = field(formData, "userId");
  if (!isUuid(orgId) || !isUuid(userId)) redirect("/agencia");
  const back = `/agencia/${orgId}`;

  const password = String(formData.get("password") ?? "");
  if (password.length < 10) fail(back, "La contraseña tiene que tener al menos 10 caracteres.");

  const result = await setUserPassword(userId, password);
  if (result.error) fail(back, result.error);

  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "user_password_reset",
    target: `user:${userId}`,
  });
  revalidatePath(back);
  redirect(`${back}?usuario=clave`);
}

export async function removeClientUser(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  const userId = field(formData, "userId");
  if (!isUuid(orgId) || !isUuid(userId)) redirect("/agencia");
  const back = `/agencia/${orgId}`;
  // Nadie se borra a sí mismo: dejaría la agencia sin dueño.
  if (userId === session.user.id) fail(back, "No puedes eliminar tu propio usuario.");

  const result = await deleteClientUser(userId);
  if (result.error) fail(back, result.error);

  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "user_deleted",
    target: `user:${userId}`,
  });
  revalidatePath(back);
  redirect(`${back}?usuario=eliminado`);
}
