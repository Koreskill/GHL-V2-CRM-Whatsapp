import { listUsersByOrg } from "@/lib/agency/users";
import { hasAdminKey } from "@/lib/supabase/admin";
import type { TeamMember } from "@/lib/team/labels";

// Solo servidor: lee los usuarios de la inmobiliaria desde Supabase Auth, así que necesita la
// clave de servicio. Si no está configurada, el resto sigue andando y el responsable queda
// "sin asignar". La etiqueta vive en @/lib/team/labels, que sí pueden usar los componentes de cliente.
export async function listTeam(orgId: string): Promise<TeamMember[]> {
  if (!hasAdminKey()) return [];
  const users = await listUsersByOrg(orgId).catch(() => []);
  return users.map((u) => ({ id: u.id, email: u.email })).sort((a, b) => a.email.localeCompare(b.email));
}

export { memberLabel } from "@/lib/team/labels";
export type { TeamMember };
