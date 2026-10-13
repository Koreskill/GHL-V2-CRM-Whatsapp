import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { organizationMembers } from "@/db/schema";
import { authorize, isUuid, jsonError } from "@/lib/api";
import { createOffers } from "@/lib/calendar/book";

// Ofrece horarios calculados (nunca inventados) y los deja como ofertas vigentes de 15 minutos.
// El tenant sale de la sesión; el asesor solicitado debe ser uno de la propia inmobiliaria.
export async function GET(req: Request) {
  const auth = await authorize("agent", { name: "cal-availability", max: 30, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const advisorId = url.searchParams.get("advisorId") ?? auth.session.user.id;
  const conversationId = url.searchParams.get("conversationId");
  if (!isUuid(advisorId)) return jsonError(400, "Asesor inválido");
  const [member] = await getDb()
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, auth.session.organizationId), eq(organizationMembers.userId, advisorId), eq(organizationMembers.status, "active")));
  if (!member) return jsonError(404, "Asesor no encontrado");
  const res = await createOffers(auth.session.organizationId, advisorId, isUuid(conversationId) ? conversationId : null);
  if (res.status === "no_configurado") return jsonError(409, "El calendario interno no está configurado");
  if (res.status === "no_verificable") return jsonError(503, "No se pudo verificar la disponibilidad del asesor");
  return Response.json({ offers: res.offers.map((o) => ({ id: o.id, startsAt: o.startsAt, endsAt: o.endsAt, expiresAt: o.expiresAt })) });
}
