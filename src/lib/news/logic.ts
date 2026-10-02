import { APP_TIME_ZONE, wallTimeToDate } from "@/lib/tz";

// Lógica pura de Novedades: quién ve qué, cómo se repiten los eventos y qué mostrar primero en el
// dashboard. Sin base de datos, para poder probar el aislamiento sin armar nada.
//
// Traducción al modelo de la plataforma:
//   cliente        = una inmobiliaria (organización)
//   red            = una red (ej. Cowin) y sus miembros activos
//   equipo interno = los administradores de la agencia (is_agency_admin)

export const EVENT_TYPES = ["activity", "reminder", "meeting", "training", "network_event", "announcement", "deadline", "custom"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  activity: "Actividad",
  reminder: "Recordatorio",
  meeting: "Reunión",
  training: "Capacitación",
  network_event: "Evento de la red",
  announcement: "Anuncio",
  deadline: "Vencimiento",
  custom: "Otro",
};

export const SCOPES = ["network", "internal", "client"] as const;
export type Scope = (typeof SCOPES)[number];

export const SCOPE_LABEL: Record<Scope, string> = {
  network: "Red",
  internal: "Equipo interno",
  client: "Cliente",
};

export const RECURRENCES = ["none", "daily", "weekly", "monthly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const isEventType = (v: unknown): v is EventType => typeof v === "string" && (EVENT_TYPES as readonly string[]).includes(v);
export const isScope = (v: unknown): v is Scope => typeof v === "string" && (SCOPES as readonly string[]).includes(v);
export const isRecurrence = (v: unknown): v is Recurrence => typeof v === "string" && (RECURRENCES as readonly string[]).includes(v);

export type NewsEvent = {
  id: string;
  scope: Scope;
  networkId: string | null;
  organizationId: string | null;
  title: string;
  description: string | null;
  eventType: EventType;
  startAt: Date;
  endAt: Date | null;
  allDay: boolean;
  location: string | null;
  meetingUrl: string | null;
  propertyId: string | null;
  assignedUserIds: string[];
  reminderAt: Date | null;
  recurrence: Recurrence;
  recurrenceUntil: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

// ── Visibilidad ─────────────────────────────────────────────────────────────

export type Viewer = {
  /** Equipo interno de la agencia. */
  isAgencyAdmin: boolean;
  /** Está trabajando dentro del espacio de un cliente (contexto de agencia). */
  acting: boolean;
  /** Inmobiliaria activa (la del usuario, o el cliente en el que entró la agencia). */
  orgId: string;
  /** Redes que puede ver. Para un miembro, las suyas; para la agencia fuera de un cliente, todas. */
  networkIds: string[];
};

/**
 * ÚNICA regla de visibilidad; la consulta SQL replica estas mismas condiciones y esta función se
 * vuelve a aplicar sobre lo que devuelve, como segunda barrera.
 *   network  -> miembros de esa red
 *   internal -> solo el equipo interno
 *   client   -> solo el equipo interno, y dentro de un cliente solo los eventos de ESE cliente
 * Un usuario externo (miembro de una inmobiliaria) nunca ve internal ni client.
 */
export function canSee(v: Viewer, e: Pick<NewsEvent, "scope" | "networkId" | "organizationId">): boolean {
  switch (e.scope) {
    case "network":
      return e.networkId !== null && v.networkIds.includes(e.networkId);
    case "internal":
      return v.isAgencyAdmin;
    case "client":
      return v.isAgencyAdmin && e.organizationId !== null && (!v.acting || e.organizationId === v.orgId);
    default:
      return false;
  }
}

/** Crear, editar y borrar: solo el equipo interno. Los demás miembros leen. */
export const canManage = (v: Viewer) => v.isAgencyAdmin;

// ── Recurrencia ─────────────────────────────────────────────────────────────

export type Occurrence = { event: NewsEvent; startAt: Date; endAt: Date | null; key: string };

const MAX_OCCURRENCES = 800;

function advance(d: Date, r: Recurrence, n: number): Date {
  const out = new Date(d);
  if (r === "daily") out.setUTCDate(out.getUTCDate() + n);
  else if (r === "weekly") out.setUTCDate(out.getUTCDate() + 7 * n);
  else if (r === "monthly") {
    // Conserva el día del mes; si no existe (31) cae al último día, no salta al mes siguiente.
    const day = d.getUTCDate();
    out.setUTCDate(1);
    out.setUTCMonth(out.getUTCMonth() + n);
    const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
    out.setUTCDate(Math.min(day, last));
  } else if (r === "yearly") out.setUTCFullYear(out.getUTCFullYear() + n);
  return out;
}

/** Las ocurrencias de un evento que caen dentro de [from, to). Las repeticiones no se guardan: se calculan. */
export function expandOccurrences(e: NewsEvent, from: Date, to: Date): Occurrence[] {
  const out: Occurrence[] = [];
  const length = e.endAt ? e.endAt.getTime() - e.startAt.getTime() : null;
  const push = (start: Date) => {
    const end = length === null ? null : new Date(start.getTime() + length);
    // Se solapa con el rango si empieza antes del final y termina después del inicio.
    if (start < to && (end ?? start) >= from) out.push({ event: e, startAt: start, endAt: end, key: `${e.id}:${start.toISOString()}` });
  };
  if (e.recurrence === "none") {
    push(e.startAt);
    return out;
  }
  for (let i = 0; i < MAX_OCCURRENCES; i++) {
    const start = advance(e.startAt, e.recurrence, i);
    if (start >= to) break;
    if (e.recurrenceUntil && start > e.recurrenceUntil) break;
    push(start);
  }
  return out;
}

export function occurrencesIn(events: NewsEvent[], from: Date, to: Date): Occurrence[] {
  return events.flatMap((e) => expandOccurrences(e, from, to)).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

// ── Fechas en hora de Argentina ─────────────────────────────────────────────

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** yyyy-mm-dd del instante, en hora de Argentina. */
export const dayKey = (d: Date) => dayFmt.format(d);

/** Primer instante del día `yyyy-mm-dd` en hora de Argentina. */
export const startOfDay = (key: string) => wallTimeToDate(`${key}T00:00`)!;

export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de `key` (la semana empieza el lunes). */
export function weekStart(key: string): string {
  const dow = new Date(`${key}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(key, -((dow + 6) % 7));
}

/** Los días que dibuja el calendario de un mes: desde el lunes anterior al 1 hasta el domingo posterior al último. */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const start = weekStart(first);
  const end = addDays(weekStart(last), 6);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

// ── Qué mostrar primero en el dashboard ─────────────────────────────────────

export type NewsItem = { occurrence: Occurrence; priority: 1 | 2 | 3 | 4; reason: "vencido" | "hoy" | "proximo" | "reciente" };

const DAY = 86_400_000;

/**
 * Prioridad: 1) recordatorios o vencimientos ya pasados y sin resolver, 2) lo de hoy, 3) lo próximo,
 * 4) anuncios recientes. Dentro de cada nivel, lo más cercano en el tiempo primero.
 */
export function prioritizeNews(occurrences: Occurrence[], now: Date, limit = 5): NewsItem[] {
  const today = dayKey(now);
  const items: NewsItem[] = [];
  for (const o of occurrences) {
    const t = o.event.eventType;
    const start = o.startAt;
    if ((t === "reminder" || t === "deadline") && start < now && start >= new Date(now.getTime() - 7 * DAY) && !sameDay(start, today)) {
      items.push({ occurrence: o, priority: 1, reason: "vencido" });
    } else if (o.event.reminderAt && o.event.reminderAt <= now && start >= now) {
      // El recordatorio ya "sonó" y el evento todavía no pasó.
      items.push({ occurrence: o, priority: 1, reason: "vencido" });
    } else if (sameDay(start, today) && (o.endAt ?? start) >= startOfDay(today)) {
      items.push({ occurrence: o, priority: 2, reason: "hoy" });
    } else if (start > now) {
      items.push({ occurrence: o, priority: 3, reason: "proximo" });
    } else if (t === "announcement" && start >= new Date(now.getTime() - 7 * DAY)) {
      items.push({ occurrence: o, priority: 4, reason: "reciente" });
    }
  }
  return items
    .sort((a, b) => a.priority - b.priority || (a.priority === 4 ? b.occurrence.startAt.getTime() - a.occurrence.startAt.getTime() : a.occurrence.startAt.getTime() - b.occurrence.startAt.getTime()))
    .slice(0, limit);
}

const sameDay = (d: Date, key: string) => dayKey(d) === key;
