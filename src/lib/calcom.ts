// Cliente mínimo de la API v2 de Cal.com. Igual que el de Zernio: nunca tira.
const BASE = "https://api.cal.com/v2";
const API_VERSION = "2024-08-13";

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

export type CalResult<T> = { ok: true; data: T } | { ok: false; error: string };

// Solo https: la URL termina en un iframe y en mensajes a clientes.
export function calcomBookingUrl(): URL | null {
  const raw = process.env.CALCOM_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export async function listUpcomingBookings(take = 20): Promise<CalResult<CalBooking[]> | null> {
  const key = process.env.CALCOM_API_KEY?.trim();
  if (!key) return null;
  try {
    const res = await fetch(`${BASE}/bookings?status=upcoming&sortStart=asc&take=${take}`, {
      headers: { Authorization: `Bearer ${key}`, "cal-api-version": API_VERSION },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as { status?: string; data?: CalBooking[]; error?: { message?: string } } | null;
    if (!res.ok || json?.status !== "success") {
      return { ok: false, error: json?.error?.message ?? `Cal.com respondió ${res.status}` };
    }
    return { ok: true, data: json.data ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Error de red con Cal.com" };
  }
}
