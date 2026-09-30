import { sql, type SQL } from "drizzle-orm";

// Filtros de Contactos. Un solo lugar define qué significa cada uno, y lo usan el listado, el
// conteo, las vistas guardadas y el público de una campaña: así los números coinciden siempre.

export const DATE_FIELDS = ["alta", "interaccion", "visita"] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export type ContactFilters = {
  q?: string;
  channel?: "whatsapp" | "instagram" | "facebook";
  propertyId?: string;
  /** Con propertyId: solo quienes mostraron interés registrado (temperatura en la propiedad). */
  onlyInterested?: boolean;
  dateField?: DateField;
  from?: string; // yyyy-mm-dd
  to?: string; // yyyy-mm-dd
  budgetMin?: number;
  budgetMax?: number;
  currency?: "USD" | "ARS";
  operation?: "venta" | "alquiler" | "temporario";
  temperature?: "frio" | "tibio" | "caliente";
};

const CHANNELS = ["whatsapp", "instagram", "facebook"] as const;
const OPERATIONS = ["venta", "alquiler", "temporario"] as const;
const TEMPS = ["frio", "tibio", "caliente"] as const;
const CURRENCIES = ["USD", "ARS"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, key: string) => (typeof p[key] === "string" ? (p[key] as string).trim() : "");
const pick = <T extends string>(list: readonly T[], value: string): T | undefined => (list as readonly string[]).includes(value) ? (value as T) : undefined;
const money = (value: string) => {
  if (!value) return undefined;
  // "100.000" y "1.500.000,50" son formato argentino (punto de miles, coma decimal); "100000.5" es decimal con punto.
  const cleaned = value.replace(/[^\d.,]/g, "");
  const arFormat = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned) || (cleaned.includes(",") && !cleaned.includes("."));
  const n = Number(arFormat ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
const day = (value: string) => {
  if (!DAY.test(value)) return undefined;
  return Number.isNaN(Date.parse(value)) ? undefined : value;
};

/** Lee los filtros de la URL. Todo valor desconocido se ignora: la URL no es de confianza. */
export function parseContactFilters(params: Params): ContactFilters {
  const q = one(params, "q");
  const propertyId = one(params, "propiedad");
  return {
    q: q ? q.slice(0, 100) : undefined,
    channel: pick(CHANNELS, one(params, "channel")),
    propertyId: UUID.test(propertyId) ? propertyId : undefined,
    onlyInterested: one(params, "interes") === "1" || undefined,
    dateField: pick(DATE_FIELDS, one(params, "campo")),
    from: day(one(params, "desde")),
    to: day(one(params, "hasta")),
    budgetMin: money(one(params, "presupuestoMin")),
    budgetMax: money(one(params, "presupuestoMax")),
    currency: pick(CURRENCIES, one(params, "moneda")),
    operation: pick(OPERATIONS, one(params, "operacion")),
    temperature: pick(TEMPS, one(params, "temperatura")),
  };
}

/** Lo contrario: de filtros a query string (para paginar y para las vistas guardadas). */
export function contactFiltersToParams(f: ContactFilters): URLSearchParams {
  const p = new URLSearchParams();
  const set = (k: string, v: string | number | undefined) => v !== undefined && v !== "" && p.set(k, String(v));
  set("q", f.q);
  set("channel", f.channel);
  set("propiedad", f.propertyId);
  if (f.onlyInterested) p.set("interes", "1");
  set("campo", f.dateField);
  set("desde", f.from);
  set("hasta", f.to);
  set("presupuestoMin", f.budgetMin);
  set("presupuestoMax", f.budgetMax);
  set("moneda", f.currency);
  set("operacion", f.operation);
  set("temperatura", f.temperature);
  return p;
}

export const hasContactFilters = (f: ContactFilters) => contactFiltersToParams(f).size > 0;

/** Normaliza lo guardado en una vista (jsonb) con las mismas reglas que la URL. */
export function contactFiltersFromJson(value: unknown): ContactFilters {
  const obj = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const params: Params = {};
  for (const [k, v] of Object.entries(obj)) if (typeof v === "string" || typeof v === "number") params[k] = String(v);
  return parseContactFilters(params);
}

/**
 * Condición SQL sobre `contacts c`. Cada relación va en un EXISTS: cruzar con deals, visitas o
 * requerimientos no multiplica filas, así que no hay contactos repetidos ni conteos inflados.
 * Toda subconsulta repite organization_id.
 */
export function contactWhere(orgId: string, f: ContactFilters): SQL {
  const parts: SQL[] = [sql`c.organization_id = ${orgId}`];

  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    parts.push(sql`(
      c.name ilike ${like} or c.phone ilike ${like} or c.email ilike ${like}
      or exists (select 1 from contact_identities ci where ci.contact_id = c.id and ci.organization_id = ${orgId} and ci.handle ilike ${like})
      or exists (select 1 from conversations cv where cv.contact_id = c.id and cv.organization_id = ${orgId}
                 and (cv.participant_name ilike ${like} or cv.participant_handle ilike ${like}))
    )`);
  }

  if (f.channel) {
    parts.push(sql`exists (select 1 from contact_identities ci where ci.contact_id = c.id and ci.organization_id = ${orgId} and ci.channel = ${f.channel}::channel)`);
  }

  if (f.temperature) parts.push(sql`c.temperature = ${f.temperature}::lead_temperature`);

  if (f.propertyId) {
    parts.push(sql`exists (
      select 1 from deal_properties dp join deals d on d.id = dp.deal_id
      where d.contact_id = c.id and d.organization_id = ${orgId} and dp.property_id = ${f.propertyId}
        ${f.onlyInterested ? sql`and dp.interest is not null` : sql``}
    )`);
  }

  if (f.from || f.to) {
    // Las fechas se interpretan en hora de Argentina: "hasta" incluye el día completo.
    const lower = f.from ? sql`>= (${f.from}::date)::timestamp at time zone 'America/Argentina/Buenos_Aires'` : sql``;
    const upper = f.to ? sql`< ((${f.to}::date) + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'` : sql``;
    const range = (col: SQL) => {
      const conds: SQL[] = [];
      if (f.from) conds.push(sql`${col} ${lower}`);
      if (f.to) conds.push(sql`${col} ${upper}`);
      return sql.join(conds, sql` and `);
    };
    const field = f.dateField ?? "alta";
    if (field === "alta") parts.push(sql`(${range(sql`c.created_at`)})`);
    else if (field === "interaccion")
      parts.push(sql`exists (select 1 from conversations cv where cv.contact_id = c.id and cv.organization_id = ${orgId} and ${range(sql`cv.last_message_at`)})`);
    else
      parts.push(sql`exists (select 1 from visits v where v.contact_id = c.id and v.organization_id = ${orgId} and ${range(sql`coalesce(v.scheduled_at, v.requested_at)`)})`);
  }

  if (f.budgetMin !== undefined || f.budgetMax !== undefined || f.operation) {
    // Presupuesto del PROSPECTO (prospect_requirements), no el de una campaña. Se comparan rangos
    // que se solapan, en la misma moneda: sin moneda no se mezclan USD con pesos.
    const conds: SQL[] = [sql`pr.contact_id = c.id`, sql`pr.organization_id = ${orgId}`, sql`pr.status = 'activo'`];
    if (f.operation) conds.push(sql`pr.operation = ${f.operation}::operation_type`);
    if (f.budgetMin !== undefined || f.budgetMax !== undefined) conds.push(sql`(pr.price_min is not null or pr.price_max is not null)`);
    if (f.budgetMin !== undefined) conds.push(sql`(pr.price_max is null or pr.price_max >= ${f.budgetMin})`);
    if (f.budgetMax !== undefined) conds.push(sql`(pr.price_min is null or pr.price_min <= ${f.budgetMax})`);
    if ((f.budgetMin !== undefined || f.budgetMax !== undefined) && f.currency) conds.push(sql`pr.currency = ${f.currency}`);
    parts.push(sql`exists (select 1 from prospect_requirements pr where ${sql.join(conds.map((c) => sql`(${c})`), sql` and `)})`);
  }

  return sql.join(parts, sql` and `);
}
