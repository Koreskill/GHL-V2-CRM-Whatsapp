import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { organizations } from "@/db/schema";

// Estados de una inmobiliaria y qué corta cada uno. ESTA es la única definición: la ingesta, el bot,
// las campañas, los seguimientos, la sesión y la red la consultan acá.
//
//              entra mensaje   bot / campañas / seguimientos   usuarios entran   en la red
// activa       se guarda       sí                              sí                sí
// suspendida   se guarda       NO (quedan para cuando vuelva)  NO                se retira
// eliminada    se descarta     NO                              NO                se retira
//
// Suspendida guarda lo entrante para no perderlo: al reactivar, el equipo lo ve en la bandeja (el bot
// NO contesta en diferido: un mensaje viejo ya venció su respuesta automática).

export const ORG_STATUSES = ["activa", "suspendida", "eliminada"] as const;
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const ORG_STATUS_LABEL: Record<OrgStatus, string> = {
  activa: "Activa",
  suspendida: "Suspendida",
  eliminada: "Eliminada (anonimizada)",
};

export const normalizeOrgStatus = (value: string | null | undefined): OrgStatus =>
  value === "suspendida" || value === "eliminada" ? value : "activa";

export const automationAllowed = (status: OrgStatus) => status === "activa";
export const ingestAllowed = (status: OrgStatus) => status !== "eliminada";
export const accessAllowed = (status: OrgStatus) => status === "activa";

// Caché corto por proceso: el estado se consulta en cada mensaje y cada paso de campaña. 15 s de
// demora máxima para que una suspensión corte todo; quien suspende además limpia la caché local.
const cache = new Map<string, { status: OrgStatus; at: number }>();
const TTL_MS = 15_000;

export async function orgStatus(orgId: string): Promise<OrgStatus> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.status;
  const [row] = await getDb().select({ status: organizations.status }).from(organizations).where(eq(organizations.id, orgId));
  // Si la organización no existe se trata como eliminada: nada automático corre sobre ella.
  const status = row ? normalizeOrgStatus(row.status) : "eliminada";
  cache.set(orgId, { status, at: Date.now() });
  return status;
}

export const forgetOrgStatus = (orgId: string) => cache.delete(orgId);

export async function canAutomate(orgId: string): Promise<boolean> {
  return automationAllowed(await orgStatus(orgId));
}
