import { redirect } from "next/navigation";
import { getSession, type Session } from "@/lib/auth";

// Toda acción del pipeline pasa por acá: sin sesión no se escribe nada, y la organización sale
// SIEMPRE del servidor, nunca de un campo del formulario (si no, cualquiera escribiría en otro tenant).
export async function authorizeAction(): Promise<{ session: Session; orgId: string }> {
  const session = await getSession();
  if (!session) redirect("/login");
  return { session, orgId: session.organizationId };
}
