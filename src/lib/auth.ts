import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { getUser } from "@/lib/supabase/server";
import { readActingOrgCookie } from "@/lib/agency/context";
import { isAgencyAdmin, orgOf, roleOf, type Role } from "@/lib/roles";

// Se reexportan para no romper lo que ya las importaba desde acá.
export { isAgencyAdmin, orgOf, roleOf };
export type { Role };

// Sin rol Y sin organización no se entra: toda query necesita saber a qué inmobiliaria pertenece.
//
// `organizationId` es la inmobiliaria ACTIVA: sobre la que se lee y se escribe. Para un usuario
// normal es siempre la suya. Para el admin de la agencia puede ser la de un cliente, cuando entró
// a su espacio desde /agencia. Así todas las páginas y APIs quedan dentro del contexto correcto
// sin que cada una tenga que acordarse.
//
// `homeOrganizationId` es la propia del usuario, la de su app_metadata. Nunca cambia.
export type Session = {
  user: User;
  email: string;
  role: Role;
  organizationId: string;
  homeOrganizationId: string;
  actingAsClient: boolean;
  isAgencyAdmin: boolean;
};

// cache(): dedup por request. El layout y cada página piden la sesión sin revalidar el token varias veces.
export const getSession = cache(async (): Promise<Session | null> => {
  const user = await getUser();
  const role = roleOf(user);
  const homeOrganizationId = orgOf(user);
  if (!user?.email || !role || !homeOrganizationId) return null;

  const agencyAdmin = isAgencyAdmin(user);
  let organizationId = homeOrganizationId;
  let actingAsClient = false;

  // La cookie de contexto SOLO vale para el admin de la agencia y solo si la inmobiliaria existe.
  // Un usuario normal que se fabrique la cookie sigue viendo únicamente lo suyo.
  if (agencyAdmin) {
    const acting = await readActingOrgCookie();
    if (acting && acting !== homeOrganizationId && (await organizationExists(acting))) {
      organizationId = acting;
      actingAsClient = true;
    }
  }

  return {
    user,
    email: user.email,
    role,
    organizationId,
    homeOrganizationId,
    actingAsClient,
    isAgencyAdmin: agencyAdmin,
  };
});

// Import perezoso: auth.ts lo carga el proxy, que corre en el runtime de edge y no debería
// arrastrar el cliente de Postgres salvo que de verdad haga falta resolver un cambio de contexto.
async function organizationExists(orgId: string): Promise<boolean> {
  try {
    const [{ getDb }, { organizations }, { eq }] = await Promise.all([
      import("@/db"),
      import("@/db/schema"),
      import("drizzle-orm"),
    ]);
    const [row] = await getDb().select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId));
    return Boolean(row);
  } catch {
    return false;
  }
}

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
