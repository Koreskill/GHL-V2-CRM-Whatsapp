import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { incidents, organizations, type IncidentSeverity, type IncidentStatus } from "@/db/schema";
import { safeError } from "@/lib/safe-error";

export const INCIDENT_MODULES = [
  "sheets",
  "mensajeria",
  "agente",
  "webhook",
  "pipeline",
  "visitas",
] as const;
export type IncidentModule = (typeof INCIDENT_MODULES)[number];

export const MODULE_LABEL: Record<IncidentModule, string> = {
  sheets: "Google Sheets",
  mensajeria: "Mensajería",
  agente: "Agente IA",
  webhook: "Webhooks",
  pipeline: "Pipeline",
  visitas: "Visitas",
};

/**
 * Registra un problema operativo.
 * El mismo problema repetido NO llena la bandeja: se agrupa por fingerprint y sube el contador.
 * Si ya estaba resuelto y vuelve a pasar, se reabre.
 *
 * Nunca guarda credenciales ni el texto de los mensajes: `detail` pasa por safeError().
 */
export async function reportIncident(input: {
  organizationId: string | null;
  module: IncidentModule;
  message: string;
  detail?: unknown;
  severity?: IncidentSeverity;
  retryTarget?: string | null;
  context?: Record<string, unknown>;
  /** Qué hace único al problema. Se le suma módulo y organización. */
  key: string;
}): Promise<void> {
  const fingerprint = createHash("sha256")
    .update(`${input.organizationId ?? "agencia"}|${input.module}|${input.key}`)
    .digest("hex");

  const detail = input.detail === undefined ? null : safeError(input.detail).slice(0, 2000);

  await getDb()
    .insert(incidents)
    .values({
      organizationId: input.organizationId,
      module: input.module,
      severity: input.severity ?? "error",
      message: input.message.slice(0, 500),
      detail,
      fingerprint,
      retryTarget: input.retryTarget ?? null,
      context: input.context ?? {},
    })
    .onConflictDoUpdate({
      target: incidents.fingerprint,
      set: {
        occurrences: sql`${incidents.occurrences} + 1`,
        lastSeenAt: sql`now()`,
        message: input.message.slice(0, 500),
        detail,
        severity: input.severity ?? "error",
        // Si volvió a pasar, deja de estar resuelto.
        status: "nuevo",
        resolvedAt: null,
      },
    })
    // Un fallo registrando el incidente nunca puede tumbar la operación que lo originó.
    .catch(() => {});
}

// Marca resuelto lo que ya no falla, sin dejar la bandeja llena de cosas viejas.
export async function resolveIncidents(organizationId: string | null, module: IncidentModule, key: string) {
  const fingerprint = createHash("sha256")
    .update(`${organizationId ?? "agencia"}|${module}|${key}`)
    .digest("hex");
  await getDb()
    .update(incidents)
    .set({ status: "resuelto", resolvedAt: sql`now()` })
    .where(and(eq(incidents.fingerprint, fingerprint), inArray(incidents.status, ["nuevo", "en_revision"])))
    .catch(() => {});
}

export type IncidentRow = {
  id: string;
  organizationId: string | null;
  organizationName: string | null;
  module: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  message: string;
  detail: string | null;
  occurrences: number;
  retryTarget: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
};

export async function listIncidents(filters: {
  organizationId?: string | null;
  module?: string;
  status?: IncidentStatus;
  limit?: number;
}): Promise<IncidentRow[]> {
  const where: SQL[] = [];
  // `null` explícito = solo los de agencia; `undefined` = todos.
  if (filters.organizationId === null) where.push(isNull(incidents.organizationId));
  else if (filters.organizationId) where.push(eq(incidents.organizationId, filters.organizationId));
  if (filters.module) where.push(eq(incidents.module, filters.module));
  if (filters.status) where.push(eq(incidents.status, filters.status));

  const rows = await getDb()
    .select({
      id: incidents.id,
      organizationId: incidents.organizationId,
      organizationName: organizations.name,
      module: incidents.module,
      severity: incidents.severity,
      status: incidents.status,
      message: incidents.message,
      detail: incidents.detail,
      occurrences: incidents.occurrences,
      retryTarget: incidents.retryTarget,
      firstSeenAt: incidents.firstSeenAt,
      lastSeenAt: incidents.lastSeenAt,
    })
    .from(incidents)
    .leftJoin(organizations, eq(organizations.id, incidents.organizationId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(incidents.lastSeenAt))
    .limit(filters.limit ?? 100);

  return rows.map((r) => ({
    ...r,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  }));
}

export async function countOpenIncidents(organizationId: string) {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(incidents)
    .where(and(eq(incidents.organizationId, organizationId), inArray(incidents.status, ["nuevo", "en_revision"])));
  return row?.n ?? 0;
}

export async function setIncidentStatus(id: string, status: IncidentStatus) {
  await getDb()
    .update(incidents)
    .set({ status, resolvedAt: status === "resuelto" ? sql`now()` : null })
    .where(eq(incidents.id, id));
}
