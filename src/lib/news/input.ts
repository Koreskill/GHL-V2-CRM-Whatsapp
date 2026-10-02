import { wallTimeToDate } from "@/lib/tz";
import { isEventType, isRecurrence, isScope, type EventType, type Recurrence, type Scope } from "./logic";

// Validación de un evento que llega de un formulario. Pura. Todo texto se recorta y toda URL tiene
// que ser https: lo que se guarda termina en pantallas de otras personas.

export type EventInput = {
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
  reminderAt: Date | null;
  recurrence: Recurrence;
  recurrenceUntil: Date | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function https(raw: string): string | null | undefined {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export type ParseResult = { ok: true; value: EventInput } | { ok: false; error: string };

export function parseEventInput(get: (key: string) => unknown): ParseResult {
  const title = text(get("title"), 160);
  if (!title) return { ok: false, error: "Poné un título." };

  const eventType = get("eventType");
  if (!isEventType(eventType)) return { ok: false, error: "Elegí un tipo de evento." };
  const scope = get("scope");
  if (!isScope(scope)) return { ok: false, error: "Elegí a quién va dirigido." };

  // Cada alcance tiene exactamente su destino.
  const networkRaw = text(get("networkId"), 64);
  const orgRaw = text(get("organizationId"), 64);
  let networkId: string | null = null;
  let organizationId: string | null = null;
  if (scope === "network") {
    if (!UUID.test(networkRaw)) return { ok: false, error: "Elegí la red." };
    networkId = networkRaw;
  } else if (scope === "client") {
    if (!UUID.test(orgRaw)) return { ok: false, error: "Elegí el cliente." };
    organizationId = orgRaw;
  }

  const allDay = get("allDay") === "on" || get("allDay") === true;
  const startRaw = text(get("startAt"), 40);
  const start = allDay ? wallTimeToDate(`${startRaw.slice(0, 10)}T00:00`) : wallTimeToDate(startRaw);
  if (!start) return { ok: false, error: "La fecha de inicio no es válida." };

  const endRaw = text(get("endAt"), 40);
  let endAt: Date | null = null;
  if (endRaw && !allDay) {
    endAt = wallTimeToDate(endRaw);
    if (!endAt) return { ok: false, error: "La fecha de fin no es válida." };
    if (endAt < start) return { ok: false, error: "El fin no puede ser anterior al inicio." };
  }

  const reminderRaw = text(get("reminderAt"), 40);
  const reminderAt = reminderRaw ? wallTimeToDate(reminderRaw) : null;
  if (reminderRaw && !reminderAt) return { ok: false, error: "La fecha del recordatorio no es válida." };

  const recurrence = (text(get("recurrence"), 12) || "none") as string;
  if (!isRecurrence(recurrence)) return { ok: false, error: "La repetición no es válida." };
  const untilRaw = text(get("recurrenceUntil"), 20);
  const recurrenceUntil = untilRaw && recurrence !== "none" ? wallTimeToDate(`${untilRaw.slice(0, 10)}T23:59`) : null;
  if (untilRaw && recurrence !== "none" && !recurrenceUntil) return { ok: false, error: "La fecha de fin de la repetición no es válida." };

  const meetingUrl = https(text(get("meetingUrl"), 500));
  if (meetingUrl === undefined) return { ok: false, error: "El enlace de la reunión tiene que ser https." };

  return {
    ok: true,
    value: {
      scope,
      networkId,
      organizationId,
      title,
      description: text(get("description"), 4000) || null,
      eventType,
      startAt: start,
      endAt,
      allDay,
      location: text(get("location"), 200) || null,
      meetingUrl,
      reminderAt,
      recurrence,
      recurrenceUntil,
    },
  };
}
