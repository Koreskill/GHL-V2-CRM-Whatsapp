import type { Candidate } from "./score";

// Qué propiedades se pueden puntuar para una organización. Puro, para poder probar el aislamiento.
// Reglas: de la cartera propia solo lo disponible o reservado (nunca vendida, alquilada, pausada o
// borrador); de la red solo lo publicado por OTRAS inmobiliarias. Nada de otra organización entra
// por la cartera, aunque llegue en la lista.

export const OFFERABLE = ["disponible", "reservada"] as const;

export type OwnRow = {
  id: string;
  organizationId: string;
  status: string;
  operation: string;
  propertyType: string;
  zone: string | null;
  city: string | null;
  price: string | number | null;
  currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: string | number | null;
  parking: number | null;
  amenities: string[];
  features: Record<string, unknown>;
};

export type NetworkRow = {
  id: string;
  ownerOrganizationId: string;
  status: string;
  operation: string;
  propertyType: string;
  zone: string | null;
  city: string | null;
  price: string | number | null;
  currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: string | number | null;
  features: Record<string, unknown>;
};

const num = (v: string | number | null): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Amenities de la red: salen de las claves de `features` que valen true, o de una lista `amenities`. */
export function amenitiesFromFeatures(features: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(features ?? {})) {
    if (k === "amenities" && Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === "string"));
    else if (v === true || v === "true" || v === "si" || v === "sí") out.push(k);
  }
  return out;
}

export function selectCandidates(orgId: string, own: OwnRow[], network: NetworkRow[]): Candidate[] {
  const out: Candidate[] = [];
  for (const p of own) {
    if (p.organizationId !== orgId) continue; // el inventario de otro cliente nunca se puntúa
    if (!(OFFERABLE as readonly string[]).includes(p.status)) continue;
    out.push({
      kind: "cartera",
      id: p.id,
      operation: p.operation,
      propertyType: p.propertyType,
      zone: p.zone,
      city: p.city,
      price: num(p.price),
      currency: p.currency,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      areaM2: num(p.areaM2),
      parking: p.parking,
      amenities: [...new Set([...p.amenities, ...amenitiesFromFeatures(p.features)])],
    });
  }
  for (const l of network) {
    if (l.ownerOrganizationId === orgId) continue; // lo propio ya está en la cartera
    if (l.status !== "publicada") continue;
    out.push({
      kind: "red",
      id: l.id,
      operation: l.operation,
      propertyType: l.propertyType,
      zone: l.zone,
      city: l.city,
      price: num(l.price),
      currency: l.currency,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      areaM2: num(l.areaM2),
      parking: null,
      amenities: amenitiesFromFeatures(l.features),
    });
  }
  return out;
}
