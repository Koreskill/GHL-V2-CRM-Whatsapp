import { and, asc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { networks, newsEvents } from "@/db/schema";
import type { Session } from "@/lib/auth";
import { activeNetworkIds } from "@/lib/delegations/flow";
import { canSee, type NewsEvent, type Scope, type Viewer } from "./logic";

type Row = typeof newsEvents.$inferSelect;

const toEvent = (r: Row): NewsEvent => ({
  id: r.id,
  scope: r.scope as Scope,
  networkId: r.networkId,
  organizationId: r.organizationId,
  title: r.title,
  description: r.description,
  eventType: r.eventType as NewsEvent["eventType"],
  startAt: r.startAt,
  endAt: r.endAt,
  allDay: r.allDay,
  location: r.location,
  meetingUrl: r.meetingUrl,
  propertyId: r.propertyId,
  assignedUserIds: r.assignedUserIds,
  reminderAt: r.reminderAt,
  recurrence: r.recurrence as NewsEvent["recurrence"],
  recurrenceUntil: r.recurrenceUntil,
  createdBy: r.createdBy,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Quién está mirando: sale de la sesión, nunca de un parámetro de la URL. */
export async function viewerFor(session: Session): Promise<Viewer> {
  let networkIds = await activeNetworkIds(session.organizationId);
  // La agencia administra las redes: fuera del espacio de un cliente ve las de todas.
  if (session.isAgencyAdmin && !session.actingAsClient) {
    networkIds = (await getDb().select({ id: networks.id }).from(networks)).map((n) => n.id);
  }
  return { isAgencyAdmin: session.isAgencyAdmin, acting: session.actingAsClient, orgId: session.organizationId, networkIds };
}

/** El espacio de UN cliente visto por el equipo interno: sus redes, lo interno y lo propio del cliente. */
export async function viewerForClient(clientOrgId: string): Promise<Viewer> {
  return { isAgencyAdmin: true, acting: true, orgId: clientOrgId, networkIds: await activeNetworkIds(clientOrgId) };
}

/** Las mismas condiciones que `canSee`, expresadas en SQL para no traer lo que no se puede ver. */
function visibilityWhere(v: Viewer): SQL {
  const parts: SQL[] = [];
  if (v.networkIds.length) parts.push(and(eq(newsEvents.scope, "network"), inArray(newsEvents.networkId, v.networkIds))!);
  if (v.isAgencyAdmin) {
    parts.push(eq(newsEvents.scope, "internal"));
    parts.push(v.acting ? and(eq(newsEvents.scope, "client"), eq(newsEvents.organizationId, v.orgId))! : eq(newsEvents.scope, "client"));
  }
  // Sin ninguna condición, no se ve nada.
  return parts.length ? or(...parts)! : sql`false`;
}

export type EventFilters = {
  scope?: Scope;
  type?: string;
  /** Solo para el equipo interno fuera de un cliente: limita a un cliente. */
  clientId?: string;
};

/**
 * Eventos visibles que caen en [from, to), incluidos los que se repiten. Sin expandir: lo hace
 * `occurrencesIn`. Se vuelve a filtrar con `canSee` como segunda barrera.
 */
export async function listVisibleEvents(v: Viewer, from: Date, to: Date, filters: EventFilters = {}): Promise<NewsEvent[]> {
  const where: SQL[] = [
    visibilityWhere(v),
    lt(newsEvents.startAt, to),
    // Los que no se repiten tienen que terminar después del inicio del rango; los que se repiten, no haber vencido.
    or(
      and(eq(newsEvents.recurrence, "none"), sql`coalesce(${newsEvents.endAt}, ${newsEvents.startAt}) >= ${from.toISOString()}::timestamptz`),
      and(sql`${newsEvents.recurrence} <> 'none'`, or(isNull(newsEvents.recurrenceUntil), gte(newsEvents.recurrenceUntil, from))),
    )!,
  ];
  if (filters.scope) where.push(eq(newsEvents.scope, filters.scope));
  if (filters.type) where.push(eq(newsEvents.eventType, filters.type));
  if (filters.clientId && v.isAgencyAdmin && !v.acting) where.push(and(eq(newsEvents.scope, "client"), eq(newsEvents.organizationId, filters.clientId))!);

  const rows = await getDb().select().from(newsEvents).where(and(...where)).orderBy(asc(newsEvents.startAt)).limit(1000);
  return rows.map(toEvent).filter((e) => canSee(v, e));
}

/** Un evento por id, o null si no existe O no se puede ver (no se distingue: no hay pistas). */
export async function getVisibleEvent(v: Viewer, id: string): Promise<NewsEvent | null> {
  const [row] = await getDb().select().from(newsEvents).where(and(eq(newsEvents.id, id), visibilityWhere(v)));
  const e = row ? toEvent(row) : null;
  return e && canSee(v, e) ? e : null;
}
