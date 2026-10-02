import { CRITERIA_KEYS, type CriterionKey } from "./profile";

// Validación de una corrección manual de preferencias. Pura. Todo lo que no cumple se descarta: el
// cuerpo del request no es de confianza.

const OPERATIONS = ["venta", "alquiler", "temporario"];
const TYPES = ["departamento", "casa", "ph", "terreno", "local", "oficina", "cochera", "otro"];
const CURRENCIES = ["USD", "ARS"];

export type ManualInput = {
  values: Partial<Record<CriterionKey, unknown>>;
  strict: Partial<Record<CriterionKey, boolean>>;
  currency?: string | null;
};

const list = (v: unknown, max = 15): string[] | null =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map((s) => s.trim().slice(0, 60)).filter(Boolean))].slice(0, max) : null;

const count = (v: unknown, max: number): number | null | undefined => {
  if (v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
};

/** `null` = vaciar el criterio (queda bloqueado para la IA); ausente = no se toca. */
export function parseManualInput(body: unknown): ManualInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const f = (b.fields && typeof b.fields === "object" ? b.fields : {}) as Record<string, unknown>;
  const values: ManualInput["values"] = {};

  if ("operation" in f) {
    if (f.operation === null || f.operation === "") values.operation = null;
    else if (typeof f.operation === "string" && OPERATIONS.includes(f.operation)) values.operation = f.operation;
  }
  if ("propertyTypes" in f) {
    const l = list(f.propertyTypes, 8)?.map((t) => t.toLowerCase()).filter((t) => TYPES.includes(t));
    if (l) values.propertyTypes = l;
  }
  for (const key of ["zones", "requiredAmenities", "preferredAmenities", "excludedFeatures"] as const) {
    if (key in f) {
      const l = list(f[key]);
      if (l) values[key] = l;
    }
  }
  if ("province" in f) {
    if (f.province === null || f.province === "") values.province = null;
    else if (typeof f.province === "string") values.province = f.province.trim().slice(0, 60);
  }
  const numbers: [CriterionKey, number][] = [["budgetMin", 1e9], ["budgetMax", 1e9], ["bedroomsMin", 30], ["bathroomsMin", 30], ["surfaceMin", 100000]];
  for (const [key, max] of numbers) {
    if (!(key in f)) continue;
    const n = count(f[key], max);
    if (n !== undefined) values[key] = n === null || key === "budgetMin" || key === "budgetMax" || key === "surfaceMin" ? n : Math.round(n);
  }
  if ("budgetFlexible" in f) {
    if (f.budgetFlexible === null) values.budgetFlexible = null;
    else if (typeof f.budgetFlexible === "boolean") values.budgetFlexible = f.budgetFlexible;
  }

  const strict: ManualInput["strict"] = {};
  const s = (b.strict && typeof b.strict === "object" ? b.strict : {}) as Record<string, unknown>;
  for (const key of CRITERIA_KEYS) if (typeof s[key] === "boolean") strict[key] = s[key] as boolean;

  const out: ManualInput = { values, strict };
  if ("currency" in f) out.currency = typeof f.currency === "string" && CURRENCIES.includes(f.currency.toUpperCase()) ? f.currency.toUpperCase() : f.currency === null ? null : undefined;
  return out;
}
