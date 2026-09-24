import { eq } from "drizzle-orm";
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
};

function toClientUser(u: {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  created_at: string;
  last_sign_in_at?: string | null;
  email_confirmed_at?: string | null;
}): ClientUser {
  const role = u.app_metadata?.crm_role;
  return {
    id: u.id,
    email: u.email ?? "",
    role: role === "admin" || role === "agent" ? role : null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    confirmed: Boolean(u.email_confirmed_at),
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
  const admin = createSupabaseAdmin();
  const users: ClientUser[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    for (const u of data.users) {
      if (u.app_metadata?.organization_id === orgId) users.push(toClientUser(u));
    }
    if (data.users.length < 1000) break;
  }
  return users;
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
