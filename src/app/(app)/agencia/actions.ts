"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { approveAccessRequest, assignAccount, listUnassignedAccounts, rejectAccessRequest } from "@/lib/agency/access";
import { createOrganization, listOrganizations, slugTaken, writeAudit } from "@/lib/agency/queries";
import { createInvitation, revokeInvitation } from "@/lib/agency/invitations";
import { createClientUser, reactivateMember, revokeMember, setUserPassword, suspendMember } from "@/lib/agency/users";
import { trustedOriginFromHeaders } from "@/lib/request-origin";
import { headers } from "next/headers";
import { toSlug } from "@/lib/agency/slug";
import { writeActingOrgCookie } from "@/lib/agency/context";
import { requireAgencyAdmin } from "@/lib/auth";
import { isUuid } from "@/lib/api";
import { hasAdminKey } from "@/lib/supabase/admin";

const MAX = 320;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const field = (form: FormData, key: string, max = MAX) => String(form.get(key) ?? "").trim().slice(0, max);

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

// Baja de la inmobiliaria: saca el acceso y conserva la identidad y el historial.
export async function removeClientUser(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  const userId = field(formData, "userId");
  if (!isUuid(orgId) || !isUuid(userId)) redirect("/agencia");
  const back = `/agencia/${orgId}`;
  // Nadie se da de baja a sí mismo: dejaría la agencia sin dueño.
  if (userId === session.user.id) fail(back, "No puedes darte de baja a ti mismo.");

  const result = await revokeMember(orgId, userId);
  if (result.error) fail(back, result.error);

  await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: orgId, action: "member_revoked", target: `user:${userId}` });
  revalidatePath(back);
  redirect(`${back}?usuario=eliminado`);
}

export async function setMemberSuspendedAction(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  const userId = field(formData, "userId");
  const suspend = field(formData, "suspend") === "1";
  if (!isUuid(orgId) || !isUuid(userId)) redirect("/agencia");
  const back = `/agencia/${orgId}`;
  if (userId === session.user.id) fail(back, "No puedes suspenderte a ti mismo.");

  const result = suspend ? await suspendMember(orgId, userId) : await reactivateMember(orgId, userId);
  if (result.error) fail(back, result.error);
  await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: orgId, action: suspend ? "member_suspended" : "member_reactivated", target: `user:${userId}` });
  revalidatePath(back);
  redirect(`${back}?usuario=${suspend ? "suspendido" : "reactivado"}`);
}

// Invitación: devuelve el enlace UNA vez (el token no se puede recuperar después: solo queda su hash).
export type InviteState = { link?: string; error?: string };
export async function inviteUserAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const session = await requireAgencyAdmin();
  if (!session) return { error: "Sin permiso." };
  const orgId = field(formData, "organizationId");
  const email = field(formData, "email").toLowerCase();
  const role = field(formData, "role") === "admin" ? "admin" : "agent";
  if (!isUuid(orgId)) return { error: "Elige una inmobiliaria." };
  if (!EMAIL_RE.test(email)) return { error: "El email no es válido." };
  if (!(await listOrganizations()).some((o) => o.id === orgId)) return { error: "La inmobiliaria no existe." };

  const origin = trustedOriginFromHeaders(await headers());
  if (!origin) return { error: "No se pudo determinar el dominio. Define ALLOWED_HOSTS." };
  const { token } = await createInvitation({ organizationId: orgId, email, role, invitedBy: session.user.id });
  await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: orgId, action: "invitation_created", target: `email:${email}`, metadata: { role } });
  revalidatePath("/agencia/accesos");
  return { link: `${origin}/invitacion/${token}` };
}

export async function revokeInvitationAction(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const id = field(formData, "invitationId");
  if (!isUuid(id)) redirect("/agencia/accesos");
  await revokeInvitation(id);
  await writeAudit({ actorUserId: session.user.id, action: "invitation_revoked", target: `invitation:${id}` });
  revalidatePath("/agencia/accesos");
  redirect("/agencia/accesos?ok=invitacion_revocada");
}

// ─── Cambio de contexto: entrar al espacio de un cliente ────────────────────
// El admin de la agencia sigue siendo él: no se hace pasar por un usuario del cliente. Lo que
// cambia es sobre qué inmobiliaria opera, y cada entrada y salida queda en audit_logs.
export async function enterClient(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  if (!isUuid(orgId)) redirect("/agencia");

  await writeActingOrgCookie(orgId);
  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "context_enter",
    target: `organization:${orgId}`,
  });

  // Se invalida todo: cada página tiene que volver a leer con la organización nueva.
  revalidatePath("/", "layout");
  redirect("/");
}

export async function exitClient() {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const previous = session.actingAsClient ? session.organizationId : null;

  await writeActingOrgCookie(null);
  if (previous) {
    await writeAudit({
      actorUserId: session.user.id,
      actingAsOrganizationId: previous,
      action: "context_exit",
      target: `organization:${previous}`,
    });
  }

  revalidatePath("/", "layout");
  redirect("/agencia");
}

// Sincronización manual de la cartera de un cliente, desde Agencia.
export async function syncClientProperties(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  if (!isUuid(orgId)) redirect("/agencia");
  const back = `/agencia/${orgId}`;

  const { syncPropertiesFromSheet } = await import("@/lib/sheets/properties-sync");
  const result = await syncPropertiesFromSheet(orgId);

  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "sheets_sync_manual",
    target: `organization:${orgId}`,
    metadata: { ok: result.ok, upserted: result.upserted, skipped: result.skipped },
  });

  revalidatePath(back);
  revalidatePath("/propiedades");
  if (!result.ok) fail(back, result.error ?? "La sincronización falló");
  redirect(`${back}?sync=${result.upserted}`);
}

// Conectar (o cambiar) la hoja de Google de un cliente.
export async function saveSheetConfig(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  if (!isUuid(orgId)) redirect("/agencia");
  const back = `/agencia/${orgId}`;

  const raw = field(formData, "spreadsheet", 500);
  const { parseSpreadsheetRef } = await import("@/lib/sheets/client");
  const ref = parseSpreadsheetRef(raw);
  if (!ref) fail(back, "Pega la URL de la hoja de Google o su identificador.");

  const { getDb } = await import("@/db");
  const { propertySyncConfigs } = await import("@/db/schema");
  const { sql } = await import("drizzle-orm");

  await getDb()
    .insert(propertySyncConfigs)
    .values({ organizationId: orgId, spreadsheetId: ref.spreadsheetId, sheetGid: ref.gid, enabled: true })
    .onConflictDoUpdate({
      target: propertySyncConfigs.organizationId,
      set: { spreadsheetId: ref.spreadsheetId, sheetGid: ref.gid, enabled: true, updatedAt: sql`now()` },
    });

  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "sheets_config",
    target: `organization:${orgId}`,
  });

  revalidatePath(back);
  redirect(`${back}?hoja=guardada`);
}

// Estado de un incidente en la bandeja de Errores y logs.
export async function updateIncident(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const id = field(formData, "incidentId", 64);
  const status = field(formData, "status", 20);
  if (!isUuid(id) || !["nuevo", "en_revision", "resuelto"].includes(status)) redirect("/agencia/errores");

  const { setIncidentStatus } = await import("@/lib/incidents/report");
  await setIncidentStatus(id, status as "nuevo" | "en_revision" | "resuelto");

  await writeAudit({
    actorUserId: session.user.id,
    action: "incident_status",
    target: `incident:${id}`,
    metadata: { status },
  });
  revalidatePath("/agencia/errores");
  redirect("/agencia/errores");
}

// Reintento de lo que sea seguro reintentar. Hoy: la sincronización de la hoja.
export async function retryIncident(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const id = field(formData, "incidentId", 64);
  const orgId = field(formData, "organizationId");
  const target = field(formData, "retryTarget", 60);
  if (!isUuid(id)) redirect("/agencia/errores");

  if (target === "sheets:sync" && isUuid(orgId)) {
    const { syncPropertiesFromSheet } = await import("@/lib/sheets/properties-sync");
    await syncPropertiesFromSheet(orgId);
  }

  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: isUuid(orgId) ? orgId : null,
    action: "incident_retry",
    target: `incident:${id}`,
    metadata: { retryTarget: target },
  });
  revalidatePath("/agencia/errores");
  redirect("/agencia/errores");
}

// Revisar la hoja de un cliente SIN importar: qué columnas se entienden y qué falta.
export async function analyzeClientSheet(_prev: unknown, formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const orgId = field(formData, "organizationId");
  if (!isUuid(orgId)) return { ok: false as const, error: "Cliente inválido." };
  const { analyzeOrgSheet } = await import("@/lib/sheets/analyze-run");
  return analyzeOrgSheet(orgId);
}

// ─── Accesos y cuentas sin asignar ──────────────────────────────────────────

// Aprobar una solicitud de Google: la agencia elige inmobiliaria y rol. Queda auditado.
export async function approveAccessAction(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  if (!hasAdminKey()) fail("/agencia/accesos", "Falta SUPABASE_SECRET_KEY en el servidor.");
  const requestId = field(formData, "requestId");
  const organizationId = field(formData, "organizationId");
  const role = field(formData, "role") === "admin" ? "admin" : "agent";
  if (!isUuid(requestId) || !isUuid(organizationId)) fail("/agencia/accesos", "Datos inválidos.");
  if (!(await listOrganizations()).some((o) => o.id === organizationId)) fail("/agencia/accesos", "La inmobiliaria no existe.");

  const res = await approveAccessRequest({ requestId, organizationId, role, actorUserId: session.user.id });
  if (res.error) fail("/agencia/accesos", res.error);
  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: organizationId,
    action: "access_approved",
    target: `access_request:${requestId}`,
    metadata: { role },
  });
  revalidatePath("/agencia/accesos");
  redirect("/agencia/accesos?ok=aprobado");
}

export async function rejectAccessAction(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const requestId = field(formData, "requestId");
  if (!isUuid(requestId)) fail("/agencia/accesos", "Datos inválidos.");
  await rejectAccessRequest(requestId, session.user.id);
  await writeAudit({ actorUserId: session.user.id, action: "access_rejected", target: `access_request:${requestId}` });
  revalidatePath("/agencia/accesos");
  redirect("/agencia/accesos?ok=rechazado");
}

export async function assignAccountAction(formData: FormData) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const externalId = field(formData, "externalId", 200);
  const organizationId = field(formData, "organizationId");
  if (!externalId || !isUuid(organizationId)) fail("/agencia/accesos", "Datos inválidos.");
  if (!(await listOrganizations()).some((o) => o.id === organizationId)) fail("/agencia/accesos", "La inmobiliaria no existe.");
  // Los datos de la cuenta salen del incidente registrado por el servidor, nunca del formulario.
  const account = (await listUnassignedAccounts()).find((a) => a.externalId === externalId);
  if (!account) fail("/agencia/accesos", "Esa cuenta ya no figura como pendiente.");

  const res = await assignAccount(account, organizationId);
  if (res.error) fail("/agencia/accesos", res.error);
  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: organizationId,
    action: "account_assigned",
    target: `channel_account:${externalId}`,
    metadata: { channel: account.channel },
  });
  revalidatePath("/agencia/accesos");
  redirect("/agencia/accesos?ok=asignada");
}
