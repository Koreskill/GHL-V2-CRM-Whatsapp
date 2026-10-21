import type { ContactFilters } from "./contact-filters";

// El criterio de un segmento o de una audiencia, en palabras. Lógica pura: así quien elige un segmento
// ve QUÉ selecciona, no solo su nombre.

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Messenger" };
const DATE_FIELD: Record<string, string> = { alta: "alta", interaccion: "última interacción", visita: "visita" };
const TEMP: Record<string, string> = { frio: "frío", tibio: "tibio", caliente: "caliente" };

export function describeFilters(f: ContactFilters, names: { labels?: Map<string, string>; groups?: Map<string, string> } = {}): string[] {
  const out: string[] = [];
  if (f.q) out.push(`que coincida con «${f.q}»`);
  if (f.channel) out.push(`con ${CHANNEL[f.channel] ?? f.channel}`);
  if (f.temperature) out.push(`temperatura ${TEMP[f.temperature] ?? f.temperature}`);
  if (f.operation) out.push(`busca ${f.operation}`);
  if (f.budgetMin !== undefined || f.budgetMax !== undefined) {
    const cur = f.currency ? ` ${f.currency}` : "";
    if (f.budgetMin !== undefined && f.budgetMax !== undefined) out.push(`presupuesto entre ${f.budgetMin} y ${f.budgetMax}${cur}`);
    else if (f.budgetMin !== undefined) out.push(`presupuesto desde ${f.budgetMin}${cur}`);
    else out.push(`presupuesto hasta ${f.budgetMax}${cur}`);
  }
  if (f.from || f.to) {
    const field = DATE_FIELD[f.dateField ?? "alta"];
    out.push(`${field} ${f.from ? `desde ${f.from}` : ""}${f.from && f.to ? " " : ""}${f.to ? `hasta ${f.to}` : ""}`);
  }
  if (f.propertyId) out.push(f.onlyInterested ? "con interés en una propiedad puntual" : "vinculado a una propiedad puntual");
  if (f.labelId) out.push(`con la etiqueta «${names.labels?.get(f.labelId) ?? "?"}»`);
  if (f.groupId) out.push(`del grupo «${names.groups?.get(f.groupId) ?? "?"}»`);
  if (f.optOut === "si") out.push("que pidieron la baja");
  if (f.optOut === "no") out.push("sin baja");
  return out;
}
