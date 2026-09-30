// Cliente de la API v2 de Cal.com para UNA cuenta (la de la inmobiliaria). Sin SDK, nunca tira.
// Endpoints y cuerpos verificados contra la documentación vigente (cal-api-version 2026-02-25):
//   POST /v2/bookings                      { start, eventTypeId, attendee{name,email,timeZone,phoneNumber,language}, metadata }
//   POST /v2/bookings/{uid}/reschedule     { start, reschedulingReason }  -> devuelve un uid NUEVO
//   POST /v2/bookings/{uid}/cancel         { cancellationReason }
//   GET  /v2/bookings?status=upcoming      (la lectura que ya usaba el Calendario)
const BASE = "https://api.cal.com/v2";
export const WRITE_API_VERSION = "2026-02-25";
const READ_API_VERSION = "2024-08-13";

export type CalResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type CalendarCreds = { apiKey: string };

async function call<T>(creds: CalendarCreds, method: "GET" | "POST", path: string, version: string, body?: unknown): Promise<CalResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "cal-api-version": version,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as { status?: string; data?: T; error?: { message?: string } | string; message?: string } | null;
    if (!res.ok || json?.status === "error") {
      const err = json?.error;
      const message = (typeof err === "string" ? err : err?.message) ?? json?.message ?? `Cal.com respondió ${res.status}`;
      return { ok: false, error: message.slice(0, 300), status: res.status };
    }
    return { ok: true, data: json?.data as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error de red con Cal.com", status: 0 };
  }
}

export type RemoteBooking = { uid: string; start: string; end?: string; status?: string };

export type AttendeeInput = { name: string; email: string; timeZone: string; phoneNumber?: string | null };

export const createBooking = (creds: CalendarCreds, input: { start: string; eventTypeId: number; attendee: AttendeeInput; metadata?: Record<string, string> }) =>
  call<RemoteBooking>(creds, "POST", "/bookings", WRITE_API_VERSION, {
    start: input.start,
    eventTypeId: input.eventTypeId,
    attendee: { name: input.attendee.name, email: input.attendee.email, timeZone: input.attendee.timeZone, language: "es", ...(input.attendee.phoneNumber ? { phoneNumber: input.attendee.phoneNumber } : {}) },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });

export const rescheduleBooking = (creds: CalendarCreds, uid: string, start: string, reason?: string) =>
  call<RemoteBooking>(creds, "POST", `/bookings/${encodeURIComponent(uid)}/reschedule`, WRITE_API_VERSION, { start, ...(reason ? { reschedulingReason: reason } : {}) });

export const cancelBooking = (creds: CalendarCreds, uid: string, reason?: string) =>
  call<unknown>(creds, "POST", `/bookings/${encodeURIComponent(uid)}/cancel`, WRITE_API_VERSION, reason ? { cancellationReason: reason } : {});

export type CalBooking = {
  uid: string;
  title: string;
  status: string;
  start: string;
  end: string;
  duration: number;
  meetingUrl: string | null;
  attendees: { name: string; email: string; timeZone?: string }[];
};

export const listUpcoming = (creds: CalendarCreds, take = 50) =>
  call<CalBooking[]>(creds, "GET", `/bookings?status=upcoming&sortStart=asc&take=${take}`, READ_API_VERSION);

/** Prueba de conexión: lista los tipos de evento de la cuenta (sirve para validar la clave y el id configurado). */
export async function testConnection(creds: CalendarCreds, eventTypeId: number): Promise<CalResult<{ eventTypeTitle: string | null }>> {
  const res = await call<{ eventTypes?: { id: number; title?: string }[] } | { id: number; title?: string }[]>(creds, "GET", "/event-types", "2024-06-14");
  if (!res.ok) return res;
  const list = Array.isArray(res.data) ? res.data : (res.data?.eventTypes ?? []);
  const found = list.find((e) => e.id === eventTypeId);
  if (!found) return { ok: false, error: `No se encontró el tipo de evento ${eventTypeId} en esa cuenta.`, status: 404 };
  return { ok: true, data: { eventTypeTitle: found.title ?? null } };
}
