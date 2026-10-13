import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/db";
import { organizationMembers } from "@/db/schema";
import type { Role } from "@/lib/auth";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

// Usuarios de un cliente. Viven en Supabase Auth: el rol y la organización están en app_metadata,
// que solo se puede escribir con la clave de servicio (nunca desde el navegador).

export type ClientUser = {
  id: string;
  email: string;
  role: Role | null;
  createdAt: string;
  lastSignInAt: string | null;
  confirmed: boolean;
  suspended: boolean;
};

function toClientUser(u: {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  created_at: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
  banned_until?: string | null;
}): ClientUser {
  const role = u.app_metadata?.crm_role;
  return {
    id: u.id,
    email: u.email ?? "",
    role: role === "admin" || role === "agent" ? role : null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    confirmed: Boolean(u.email_confirmed_at),
    suspended: Boolean(u.banned_until && new Date(u.banned_until).getTime() > Date.now()),
  };
}

// listUsers pagina de a 1000; con la cantidad de usuarios de una agencia alcanza con la primera
// página, pero se recorren todas para no perder a nadie cuando crezca.
async function allUsers(): Promise<ClientUser[]> {
  const admin = createSupabaseAdmin();
  const out: ClientUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const u of data.users) out.push(toClientUser(u));
    if (data.users.length < 1000) break;
  }
  return out;
}

export async function listUsersByOrg(orgId: string): Promise<ClientUser[]> {
  // Primero las membresías del tenant y solo después Auth: antes se recorrían TODOS los usuarios
  // de la plataforma para quedarse con los de una inmobiliaria.
  const members = await getDb().select({ userId: organizationMembers.userId }).from(organizationMembers).where(eq(organizationMembers.organizationId, orgId));
  const admin = createSupabaseAdmin();
  const found = await Promise.all(
    members.map(async (m) => {
      const { data } = await admin.auth.admin.getUserById(m.userId);
      return data.user && data.user.app_metadata?.organization_id === orgId ? toClientUser(data.user) : null;
    }),
  );
  return found.filter((u): u is ClientUser => u !== null);
}

// Cuántos usuarios tiene cada organización, para la tabla de clientes.
export async function countUsersByOrg(): Promise<Record<string, number>> {
  const admin = createSupabaseAdmin();
  const counts: Record<string, number> = {};
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const u of data.users) {
      const org = u.app_metadata?.organization_id;
      if (typeof org === "string") counts[org] = (counts[org] ?? 0) + 1;
    }
    if (data.users.length < 1000) break;
  }
  return counts;
}

export async function emailTaken(email: string) {
  const users = await allUsers();
  return users.some((u) => u.email.toLowerCase() === email.toLowerCase());
}

// Crea el usuario en Auth con su rol y organización, y deja la fila espejo en organization_members
// (la que usan las queries del CRM para unir por SQL sin ir a Auth).
export async function createClientUser(input: {
  email: string;
  password: string;
  organizationId: string;
  role: Role;
  fullName?: string | null;
}): Promise<{ id: string } | { error: string }> {
  const admin = createSupabaseAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    // Sin confirmación por mail: el dueño de la agencia entrega la contraseña y el cliente entra ya.
    email_confirm: true,
    app_metadata: { crm_role: input.role, organization_id: input.organizationId },
    user_metadata: input.fullName ? { full_name: input.fullName } : {},
  });
  if (error || !data.user) return { error: error?.message ?? "No se pudo crear el usuario" };

  await getDb()
    .insert(organizationMembers)
    .values({
      userId: data.user.id,
      organizationId: input.organizationId,
      role: input.role === "admin" ? "admin" : "agente",
    })
    .onConflictDoNothing();

  return { id: data.user.id };
}

// Cambio de contraseña desde el panel de agencia: el dueño la fija y se la pasa al cliente.
export async function setUserPassword(userId: string, password: string): Promise<{ error?: string }> {
  const admin = createSupabaseAdmin();
  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  return error ? { error: error.message } : {};
}

export async function deleteClientUser(userId: string): Promise<{ error?: string }> {
  const admin = createSupabaseAdmin();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return { error: error.message };
  await getDb().delete(organizationMembers).where(eq(organizationMembers.userId, userId));
  return {};
}

// ─── Ciclo de vida de un miembro ────────────────────────────────────────────
// Suspender revoca el acceso YA (ban en Auth + getSession rechaza toda membresía que no esté `active`) y conserva
// todo: historial, autoría de oportunidades y visitas. Dar de baja saca al usuario de la inmobiliaria pero
// NO borra su identidad: puede tener otras membresías o referencias comerciales.

async function activeAdmins(orgId: string, exceptUserId: string) {
  const rows = await getDb()
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.organizationId, orgId),
        eq(organizationMembers.role, "admin"),
        eq(organizationMembers.status, "active"),
        ne(organizationMembers.userId, exceptUserId),
      ),
    );
  return rows.length;
}

async function memberOf(orgId: string, userId: string) {
  const [m] = await getDb()
    .select()
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.userId, userId)));
  return m ?? null;
}

export async function suspendMember(orgId: string, userId: string): Promise<{ error?: string }> {
  const m = await memberOf(orgId, userId);
  if (!m) return { error: "El usuario no pertenece a esta inmobiliaria." };
  if (m.role === "admin" && (await activeAdmins(orgId, userId)) === 0) return { error: "Es el único administrador activo: no se puede suspender." };
  const { error } = await createSupabaseAdmin().auth.admin.updateUserById(userId, { ban_duration: "876000h" });
  if (error) return { error: error.message };
  await getDb().update(organizationMembers).set({ status: "suspended", updatedAt: new Date() }).where(eq(organizationMembers.id, m.id));
  return {};
}

export async function reactivateMember(orgId: string, userId: string): Promise<{ error?: string }> {
  const m = await memberOf(orgId, userId);
  if (!m) return { error: "El usuario no pertenece a esta inmobiliaria." };
  const { error } = await createSupabaseAdmin().auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (error) return { error: error.message };
  await getDb().update(organizationMembers).set({ status: "active", updatedAt: new Date() }).where(eq(organizationMembers.id, m.id));
  return {};
}

export async function revokeMember(orgId: string, userId: string): Promise<{ error?: string }> {
  const m = await memberOf(orgId, userId);
  if (!m) return { error: "El usuario no pertenece a esta inmobiliaria." };
  if (m.role === "admin" && (await activeAdmins(orgId, userId)) === 0) return { error: "Es el único administrador activo: no se puede dar de baja." };
  const admin = createSupabaseAdmin();
  const { data } = await admin.auth.admin.getUserById(userId);
  // Solo se limpia el rol si su organización activa ERA esta: no se pisa otra pertenencia.
  if (data.user?.app_metadata?.organization_id === orgId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { app_metadata: { crm_role: null, organization_id: null } });
    if (error) return { error: error.message };
  }
  await getDb().update(organizationMembers).set({ status: "revoked", updatedAt: new Date() }).where(eq(organizationMembers.id, m.id));
  return {};
}

/**
 * Inmobiliaria a la que ya pertenece la cuenta según Auth (null si no tiene ninguna). `app_metadata` guarda UNA
 * sola: aprobar o aceptar una invitación sobre una cuenta con otra inmobiliaria la sacaría de ahí sin avisar.
 */
export async function activeOrganizationOf(userId: string): Promise<{ orgId: string | null; error?: string }> {
  const { data, error } = await createSupabaseAdmin().auth.admin.getUserById(userId);
  if (error || !data.user) return { orgId: null, error: error?.message ?? "No se encontró la cuenta." };
  const meta = data.user.app_metadata as Record<string, unknown> | undefined;
  return { orgId: meta?.crm_role && typeof meta.organization_id === "string" ? meta.organization_id : null };
}
