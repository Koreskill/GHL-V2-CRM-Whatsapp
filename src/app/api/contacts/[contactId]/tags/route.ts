import { leadTemperatureEnum, operationTypeEnum, urgencyEnum } from "@/db/schema";
import { authorize, isUuid, jsonError } from "@/lib/api";
import { getContactTagSummary, updateContactTags, type TagPatch } from "@/lib/crm/tags";

const TEMPERATURES = new Set(leadTemperatureEnum.enumValues);
const OPERATIONS = new Set(operationTypeEnum.enumValues);
const URGENCIES = new Set(urgencyEnum.enumValues);

export async function GET(_req: Request, ctx: RouteContext<"/api/contacts/[contactId]/tags">) {
  const auth = await authorize();
  if ("response" in auth) return auth.response;
  const { contactId } = await ctx.params;
  if (!isUuid(contactId)) return jsonError(400, "Id de contacto inválido");

  const summary = await getContactTagSummary(contactId, auth.session.organizationId);
  return Response.json(summary);
}

// Cada campo presente en el body es una decisión explícita de quien edita: pisa lo que hubiera
// (incluso a null, para vaciarlo). Lo que no viene queda como está. La UI nunca manda un campo
// que no cambió: si lo mandara en null, borraría un dato que el bot venía completando solo.
export async function PATCH(req: Request, ctx: RouteContext<"/api/contacts/[contactId]/tags">) {
  const auth = await authorize();
  if ("response" in auth) return auth.response;
  const { contactId } = await ctx.params;
  if (!isUuid(contactId)) return jsonError(400, "Id de contacto inválido");

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return jsonError(400, "Body inválido");

  const patch: TagPatch = {};

  if ("temperature" in body) {
    const v = body.temperature;
    if (v !== null && !TEMPERATURES.has(v as never)) return jsonError(400, "Temperatura inválida");
    patch.temperature = v as TagPatch["temperature"];
  }
  if ("operation" in body) {
    const v = body.operation;
    if (v !== null && !OPERATIONS.has(v as never)) return jsonError(400, "Operación inválida");
    patch.operation = v as TagPatch["operation"];
  }
  if ("urgency" in body) {
    const v = body.urgency;
    if (v !== null && !URGENCIES.has(v as never)) return jsonError(400, "Urgencia inválida");
    patch.urgency = v as TagPatch["urgency"];
  }
  if ("zones" in body) {
    if (!Array.isArray(body.zones) || !body.zones.every((z) => typeof z === "string")) {
      return jsonError(400, "Zonas inválidas");
    }
    patch.zones = (body.zones as string[]).map((z) => z.trim()).filter(Boolean).slice(0, 15);
  }
  if ("propertyTypes" in body) {
    if (!Array.isArray(body.propertyTypes) || !body.propertyTypes.every((t) => typeof t === "string")) {
      return jsonError(400, "Tipos de propiedad inválidos");
    }
    patch.propertyTypes = (body.propertyTypes as string[]).map((t) => t.trim()).filter(Boolean).slice(0, 8);
  }
  if ("priceMin" in body) {
    const v = body.priceMin;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) return jsonError(400, "Presupuesto mínimo inválido");
    patch.priceMin = v as number | null;
  }
  if ("priceMax" in body) {
    const v = body.priceMax;
    if (v !== null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) return jsonError(400, "Presupuesto máximo inválido");
    patch.priceMax = v as number | null;
  }
  if ("currency" in body) {
    const v = body.currency;
    if (typeof v !== "string" || !/^[A-Z]{3}$/.test(v)) return jsonError(400, "Moneda inválida: código de 3 letras");
    patch.currency = v;
  }

  if (!Object.keys(patch).length) return jsonError(400, "No hay nada para actualizar");

  try {
    const summary = await updateContactTags({ organizationId: auth.session.organizationId, contactId, patch });
    return Response.json(summary);
  } catch {
    return jsonError(404, "Contacto no encontrado");
  }
}
