import type { LeadTemperature, OperationType, ProspectUrgency } from "@/db/schema";

/**
 * Tipos y textos de las etiquetas del contacto — SIN nada que toque la base.
 *
 * Separado de `tags.ts` a propósito: ese archivo importa `@/db`, que arrastra el driver de
 * Postgres. Si un componente de cliente (como `ContactTagsBar`) lo importara para sacar de ahí
 * estos labels, el build intentaría meter `postgres`/`tls` en el bundle del navegador y rompería
 * (ver CLAUDE.md: el mismo problema que separa `roles.ts` de `auth.ts`).
 */

export const OPERATION_LABEL: Record<OperationType, string> = {
  venta: "Compra",
  alquiler: "Alquiler",
  temporario: "Temporario",
};

export const URGENCY_LABEL: Record<ProspectUrgency, string> = {
  explorando: "Explorando",
  meses: "En 3 meses",
  ya: "Ahora",
};

export const TEMPERATURE_META: Record<LeadTemperature, { label: string; dot: string; text: string }> = {
  caliente: { label: "Caliente", dot: "bg-accent-red", text: "text-accent-red" },
  tibio: { label: "Tibio", dot: "bg-accent-amber", text: "text-accent-amber" },
  frio: { label: "Frío", dot: "bg-muted/50", text: "text-muted" },
};

export type ContactTagSummary = {
  contactId: string;
  temperature: LeadTemperature | null;
  operation: OperationType | null;
  urgency: ProspectUrgency | null;
  zones: string[];
  propertyTypes: string[];
  priceMin: number | null;
  priceMax: number | null;
  currency: string;
  requirementId: string | null;
};

export type TagPatch = {
  temperature?: LeadTemperature | null;
  operation?: OperationType | null;
  urgency?: ProspectUrgency | null;
  zones?: string[];
  propertyTypes?: string[];
  priceMin?: number | null;
  priceMax?: number | null;
  currency?: string;
};
