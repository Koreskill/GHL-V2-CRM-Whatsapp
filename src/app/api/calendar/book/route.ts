import { authorize, isUuid, jsonError } from "@/lib/api";
import { bookOffer } from "@/lib/calendar/book";

// Reserva una oferta vigente para una visita. Revalida disponibilidad justo antes de reclamar el horario.
export async function POST(req: Request) {
  const auth = await authorize("agent", { name: "cal-book", max: 20, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  const body = (await req.json().catch(() => null)) as { offerId?: unknown; visitId?: unknown } | null;
  if (!isUuid(body?.offerId) || !isUuid(body?.visitId)) return jsonError(400, "Se espera { offerId, visitId }");
  const res = await bookOffer({ orgId: auth.session.organizationId, offerId: body.offerId, visitId: body.visitId, actorUserId: auth.session.user.id });
  if (res.ok) return Response.json({ ok: true, startsAt: res.startsAt });
  const status = { ocupado: 409, no_disponible: 409, oferta_invalida: 410, no_verificable: 503, no_configurado: 409, visita_invalida: 404 }[res.reason];
  return jsonError(status, res.reason);
}
