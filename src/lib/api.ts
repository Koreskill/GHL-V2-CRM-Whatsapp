import { getSession, type Role, type Session } from "@/lib/auth";
import { rateLimit, tooManyRequests } from "@/lib/rate-limit";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const jsonError = (status: number, error: string) => Response.json({ error }, { status });

type Limit = { name: string; max: number; windowMs: number };

// Devuelve la sesión o la respuesta de error lista para devolver. El rol y el límite se validan
// en el servidor: ocultar un botón en la interfaz no protege nada.
export async function authorize(
  role: Role = "agent",
  limit?: Limit,
): Promise<{ session: Session } | { response: Response }> {
  const session = await getSession();
  if (!session) return { response: jsonError(401, "No autorizado") };
  if (role === "admin" && session.role !== "admin") return { response: jsonError(403, "Solo un administrador puede hacer esto") };
  if (limit) {
    const r = rateLimit(`${limit.name}:${session.user.id}`, limit.max, limit.windowMs);
    if (!r.ok) return { response: tooManyRequests(r.retryAfterSec) };
  }
  return { session };
}
