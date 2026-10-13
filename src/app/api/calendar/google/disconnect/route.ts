import { authorize, jsonError } from "@/lib/api";
import { disconnect } from "@/lib/calendar/google/connections";

// Desconecta SOLO la conexión del usuario que lo pide: la de otra persona no se toca ni desde la agencia.
export async function POST() {
  const auth = await authorize("agent", { name: "gcal-disconnect", max: 10, windowMs: 60_000 });
  if ("response" in auth) return auth.response;
  if (auth.session.actingAsClient) return jsonError(403, "Desde el modo agencia no se gestionan calendarios personales");
  await disconnect(auth.session.organizationId, auth.session.user.id);
  return Response.json({ ok: true });
}
