import { SCORING } from "./config";

// Perfil estructurado del contacto, con la procedencia de cada dato. Puro: sin base de datos.
//
// Los VALORES viven en las columnas de prospect_requirements (las leen el Pipeline y el triaje);
// la procedencia vive en prospect_requirements.criteria. Para cada criterio se puede responder:
// qué valor hay, de dónde salió (IA o corrección manual), con qué confianza y cuándo.

export const CRITERIA_KEYS = [
  "operation",
  "propertyTypes",
  "zones",
  "province",
  "budgetMin",
  "budgetMax",
  "budgetFlexible",
  "bedroomsMin",
  "bathroomsMin",
  "surfaceMin",
  "requiredAmenities",
  "preferredAmenities",
  "excludedFeatures",
] as const;
export type CriterionKey = (typeof CRITERIA_KEYS)[number];

export type CriterionMeta = {
  /** true = indispensable (duro), false = preferencia (blando), null = no lo aclaró. */
  strict: boolean | null;
  /** 0–1. */
  confidence: number;
  source: "ai" | "manual";
  messageId: string | null;
  updatedAt: string;
};

export type Criterion<T> = { value: T } & CriterionMeta;

export type LeadProfile = {
  operation?: Criterion<string>;
  propertyTypes?: Criterion<string[]>;
  zones?: Criterion<string[]>;
  province?: Criterion<string>;
  budgetMin?: Criterion<number>;
  budgetMax?: Criterion<number>;
  budgetFlexible?: Criterion<boolean>;
  bedroomsMin?: Criterion<number>;
  bathroomsMin?: Criterion<number>;
  surfaceMin?: Criterion<number>;
  requiredAmenities?: Criterion<string[]>;
  preferredAmenities?: Criterion<string[]>;
  excludedFeatures?: Criterion<string[]>;
  /** Moneda que el contacto NOMBRÓ. Null = no la dijo (se asume la de cada propiedad). */
  currency: string | null;
};

/** Valores planos tal como están en prospect_requirements, más lo que solo existe en `criteria`. */
export type FlatValues = {
  operation: string | null;
  propertyTypes: string[];
  zones: string[];
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  currencyExplicit: boolean;
  bedroomsMin: number | null;
  bathroomsMin: number | null;
  areaMin: number | null;
  mustHave: string[];
  niceToHave: string[];
};

export type StoredCriteria = Partial<Record<CriterionKey, Partial<CriterionMeta> & { value?: unknown }>>;

const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Mapa criterio → columna plana que lo guarda (los que no tienen columna viven solo en `criteria`). */
export const FLAT_COLUMN: Partial<Record<CriterionKey, string>> = {
  operation: "operation",
  propertyTypes: "propertyTypes",
  zones: "zones",
  budgetMin: "priceMin",
  budgetMax: "priceMax",
  bedroomsMin: "bedroomsMin",
  bathroomsMin: "bathroomsMin",
  surfaceMin: "areaMin",
  requiredAmenities: "mustHave",
  preferredAmenities: "niceToHave",
};

const arrayKeys = new Set<CriterionKey>(["propertyTypes", "zones", "requiredAmenities", "preferredAmenities", "excludedFeatures"]);
export const isArrayCriterion = (k: CriterionKey) => arrayKeys.has(k);

function flatValue(flat: FlatValues, key: CriterionKey): unknown {
  switch (key) {
    case "operation": return flat.operation;
    case "propertyTypes": return flat.propertyTypes;
    case "zones": return flat.zones;
    case "budgetMin": return flat.priceMin;
    case "budgetMax": return flat.priceMax;
    case "bedroomsMin": return flat.bedroomsMin;
    case "bathroomsMin": return flat.bathroomsMin;
    case "surfaceMin": return flat.areaMin;
    case "requiredAmenities": return flat.mustHave;
    case "preferredAmenities": return flat.niceToHave;
    default: return undefined; // province, budgetFlexible, excludedFeatures: solo en `criteria`
  }
}

const empty = (v: unknown) => v === null || v === undefined || (Array.isArray(v) && v.length === 0) || v === "";

/**
 * Arma el perfil a partir de las columnas planas y la procedencia guardada. Un dato que está en la
 * columna pero sin procedencia (perfiles anteriores a esta función) entra como IA con confianza baja.
 */
export function profileFromStored(flat: FlatValues, stored: StoredCriteria | null | undefined): LeadProfile {
  const profile: LeadProfile = { currency: flat.currencyExplicit ? flat.currency : null };
  const target = profile as Record<string, unknown>;
  for (const key of CRITERIA_KEYS) {
    const meta = stored?.[key];
    const value = meta && "value" in meta && flatValue(flat, key) === undefined ? meta.value : flatValue(flat, key);
    if (empty(value)) continue;
    // Una corrección manual que dejó el campo vacío ya se filtró arriba; acá solo entra lo que tiene valor.
    target[key] = {
      value,
      strict: typeof meta?.strict === "boolean" ? meta.strict : null,
      confidence: typeof meta?.confidence === "number" ? meta.confidence : SCORING.legacyConfidence,
      source: meta?.source === "manual" ? "manual" : "ai",
      messageId: meta?.messageId ?? null,
      updatedAt: meta?.updatedAt ?? "",
    };
  }
  return profile;
}

/** Cuántos criterios tiene cargados el perfil (para saber si hay algo que puntuar). */
export const knownCriteria = (p: LeadProfile): CriterionKey[] => CRITERIA_KEYS.filter((k) => p[k] !== undefined && k !== "budgetFlexible");

// ── Actualización con procedencia ───────────────────────────────────────────

export type Change = {
  key: CriterionKey;
  /** null = vaciar el criterio. */
  value: unknown;
  strict?: boolean | null;
};

export type ChangeMeta = { source: "ai" | "manual"; messageId: string | null; confidence: number; now: string };

const normArr = (a: string[]) => a.map((s) => s.trim().toLowerCase()).sort();
function sameValue(a: unknown, b: unknown): boolean {
  if (isStrArray(a) && isStrArray(b)) return JSON.stringify(normArr(a)) === JSON.stringify(normArr(b));
  if (empty(a) && empty(b)) return true;
  return a === b;
}

/** Criterios que una persona corrigió: la extracción automática no los vuelve a pisar. */
export function lockedKeys(stored: StoredCriteria | null | undefined): Set<CriterionKey> {
  const out = new Set<CriterionKey>();
  for (const key of CRITERIA_KEYS) if (stored?.[key]?.source === "manual") out.add(key);
  return out;
}

export type ChangeResult = {
  /** `criteria` completo, listo para guardar. */
  criteria: StoredCriteria;
  /** Valores para las columnas planas (solo las que cambian). */
  flat: Record<string, unknown>;
  /** Criterios cuyo valor o exigencia cambió de verdad. */
  changed: CriterionKey[];
};

/**
 * Aplica cambios al perfil y registra la procedencia.
 *  - IA: no pisa lo corregido a mano; las listas se ACUMULAN (si antes dijo Centro y ahora agrega Fisherton,
 *    busca en las dos). Lo que no vino no se toca.
 *  - Manual: reemplaza (también las listas) y deja el criterio "bloqueado" para la IA.
 * Solo cuenta como cambio lo que realmente cambia: repetir el mismo dato no mueve nada.
 */
export function applyChanges(current: FlatValues, stored: StoredCriteria | null | undefined, changes: Change[], meta: ChangeMeta): ChangeResult {
  const criteria: StoredCriteria = { ...(stored ?? {}) };
  const flat: Record<string, unknown> = {};
  const changed: CriterionKey[] = [];
  const locked = lockedKeys(stored);

  for (const ch of changes) {
    if (meta.source === "ai" && locked.has(ch.key)) continue; // la corrección humana manda

    const before = criteria[ch.key];
    const previousValue = flatValue(current, ch.key) ?? before?.value ?? null;
    // value undefined = solo cambia la exigencia (estricto/flexible), no el dato.
    let next: unknown = ch.value === undefined ? previousValue : ch.value;

    if (meta.source === "ai" && isArrayCriterion(ch.key) && isStrArray(next) && isStrArray(previousValue)) {
      next = [...new Set([...previousValue, ...next].map((s) => s.trim()).filter(Boolean))].slice(0, 15);
    }
    const valueChanged = !sameValue(previousValue, next);
    const strictChanged = ch.strict !== undefined && ch.strict !== (before?.strict ?? null);
    if (!valueChanged && !strictChanged && !(meta.source === "manual" && before?.source !== "manual")) continue;

    const column = FLAT_COLUMN[ch.key];
    const hasColumn = column !== undefined;
    criteria[ch.key] = {
      ...(hasColumn ? {} : { value: next }),
      strict: ch.strict !== undefined ? ch.strict : (before?.strict ?? null),
      confidence: meta.confidence,
      source: meta.source,
      messageId: meta.messageId,
      updatedAt: meta.now,
    };
    if (hasColumn && valueChanged) flat[column!] = isArrayCriterion(ch.key) ? (next ?? []) : next;
    if (valueChanged || strictChanged) changed.push(ch.key);
  }
  return { criteria, flat, changed };
}

/** Los cambios de una corrección manual a partir de un formulario ya validado. */
export function manualChanges(input: Partial<Record<CriterionKey, unknown>>, strict: Partial<Record<CriterionKey, boolean>> = {}): Change[] {
  const out: Change[] = [];
  for (const key of CRITERIA_KEYS) {
    if (!(key in input)) continue;
    out.push({ key, value: input[key] ?? null, ...(key in strict ? { strict: strict[key] } : {}) });
  }
  for (const [key, value] of Object.entries(strict) as [CriterionKey, boolean][]) {
    if (!(key in input)) out.push({ key, value: undefined as never, strict: value });
  }
  return out;
}
