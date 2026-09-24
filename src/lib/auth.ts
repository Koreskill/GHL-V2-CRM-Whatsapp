import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getUser } from "@/lib/supabase/server";

// El rol vive en app_metadata: solo se puede escribir con la service key o por SQL, nunca desde el cliente.
// Un usuario sin rol (por ejemplo, alguien que se registró solo) no entra.
export type Role = "admin" | "agent";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function roleOf(user: Pick<User, "app_metadata"> | null | undefined): Role | null {
  const role = user?.app_metadata?.crm_role;
  return role === "admin" || role === "agent" ? role : null;
}

// El tenant vive en app_metadata: resolución rápida (también en el proxy) sin ir a la base.
export function orgOf(user: Pick<User, "app_metadata"> | null | undefined): string | null {
  const org = user?.app_metadata?.organization_id;
  return typeof org === "string" && UUID.test(org) ? org : null;
}

// El admin de la agencia opera en un plano separado: puede actuar sobre cualquier inmobiliaria
// (con cambio de contexto explícito y auditado). Solo se setea por SQL/service key.
export function isAgencyAdmin(user: Pick<User, "app_metadata"> | null | undefined): boolean {
  return user?.app_metadata?.is_agency_admin === true;
}

// Sin rol Y sin organización no se entra: toda query necesita saber a qué inmobiliaria pertenece.
export type Session = { user: User; email: string; role: Role; organizationId: string; isAgencyAdmin: boolean };

// cache(): dedup por request. El layout y cada página piden la sesión sin revalidar el token varias veces.
export const getSession = cache(async (): Promise<Session | null> => {
  const user = await getUser();
  const role = roleOf(user);
  const organizationId = orgOf(user);
  if (!user?.email || !role || !organizationId) return null;
  return { user, email: user.email, role, organizationId, isAgencyAdmin: isAgencyAdmin(user) };
});

export async function requireRole(role: Role): Promise<Session | null> {
  const session = await getSession();
  if (!session) return null;
  if (role === "admin" && session.role !== "admin") return null;
  return session;
}

// Para páginas (server components) protegidas por el layout: devuelve la org o manda al login.
export async function requireOrgId(): Promise<string> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session.organizationId;
}

// Plano de agencia: solo el dueño del CRM (is_agency_admin) ve y administra a los clientes.
// Se valida en el servidor en cada página y acción, no alcanza con esconder el menú.
export async function requireAgencyAdmin(): Promise<Session | null> {
  const session = await getSession();
  return session?.isAgencyAdmin ? session : null;
}
