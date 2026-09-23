import type { User } from "@supabase/supabase-js";
import { getUser } from "@/lib/supabase/server";

// El rol vive en app_metadata: solo se puede escribir con la service key o por SQL, nunca desde el cliente.
// Un usuario sin rol (por ejemplo, alguien que se registró solo) no entra.
export type Role = "admin" | "agent";

export function roleOf(user: Pick<User, "app_metadata"> | null | undefined): Role | null {
  const role = user?.app_metadata?.crm_role;
  return role === "admin" || role === "agent" ? role : null;
}

export type Session = { user: User; email: string; role: Role };

export async function getSession(): Promise<Session | null> {
  const user = await getUser();
  const role = roleOf(user);
  if (!user?.email || !role) return null;
  return { user, email: user.email, role };
}

export async function requireRole(role: Role): Promise<Session | null> {
  const session = await getSession();
  if (!session) return null;
  if (role === "admin" && session.role !== "admin") return null;
  return session;
}
