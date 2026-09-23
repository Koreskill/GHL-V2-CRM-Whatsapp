import { getSession, type Role, type Session } from "@/lib/auth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const jsonError = (status: number, error: string) => Response.json({ error }, { status });

// Devuelve la sesión o la respuesta de error lista para devolver.
export async function authorize(role: Role = "agent"): Promise<{ session: Session } | { response: Response }> {
  const session = await getSession();
  if (!session) return { response: jsonError(401, "No autorizado") };
  if (role === "admin" && session.role !== "admin") return { response: jsonError(403, "Solo un administrador puede hacer esto") };
  return { session };
}
