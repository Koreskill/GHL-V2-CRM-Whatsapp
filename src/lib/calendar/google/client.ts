import { createHash, randomBytes } from "node:crypto";

// Cliente de Google Calendar SIN SDK (fetch nativo, igual que Zernio): resultado { ok, data } | { ok: false, ... },
// nunca tira. Solo los permisos mínimos; ver OPE-005 §6.3.
//
// Scopes: listar calendarios, consultar ocupación (freebusy) y administrar los calendarios SECUNDARIOS que crea
// la propia aplicación. No se pide acceso completo, ni compartir, ni borrar calendarios ajenos.

export const GOOGLE_SCOPES = {
  calendarList: "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  freebusy: "https://www.googleapis.com/auth/calendar.events.freebusy",
  appCreated: "https://www.googleapis.com/auth/calendar.app.created",
} as const;

export const REQUESTED_SCOPES = ["openid", "email", ...Object.values(GOOGLE_SCOPES)];
// Sin freebusy no se puede calcular disponibilidad: la conexión no sirve.
export const REQUIRED_SCOPES = [GOOGLE_SCOPES.freebusy];

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

export type GResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number; reauth?: boolean };

export function googleCalendarConfigured() {
  return Boolean(process.env.GOOGLE_CALENDAR_CLIENT_ID && process.env.GOOGLE_CALENDAR_CLIENT_SECRET);
}

const clientId = () => process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "";
const clientSecret = () => process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "";

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const b64url = (b: Buffer) => b.toString("base64url");

export function newPkce() {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl(input: { redirectUri: string; state: string; challenge: string; loginHint?: string }) {
  const u = new URL(AUTH_URL);
  u.searchParams.set("client_id", clientId());
  u.searchParams.set("redirect_uri", input.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", REQUESTED_SCOPES.join(" "));
  // offline = refresh token para sincronizar sin sesión abierta. include_granted_scopes NO: no se hereda nada.
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", input.state);
  u.searchParams.set("code_challenge", input.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (input.loginHint) u.searchParams.set("login_hint", input.loginHint);
  return u.toString();
}

async function tokenRequest(body: Record<string, string>): Promise<GResult<{ access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string }>> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId(), client_secret: clientSecret(), ...body }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) return { ok: false, error: "No se pudo contactar a Google", status: 0 };
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = String(json.error ?? "");
    // invalid_grant = revocado, vencido (app en modo Testing: 7 días) o contraseña cambiada: hay que reconectar.
    return { ok: false, error: code || `HTTP ${res.status}`, status: res.status, reauth: code === "invalid_grant" };
  }
  return { ok: true, data: json as never };
}

export const exchangeCode = (code: string, verifier: string, redirectUri: string) =>
  tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri });

export const refreshAccessToken = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

export async function revokeToken(token: string) {
  await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

/** Email de la cuenta de Google, del id_token (la firma ya la validó el canje directo con Google por TLS). */
export function emailFromIdToken(idToken?: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from((idToken ?? "").split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; email_verified?: boolean };
    return payload.email && payload.email_verified !== false ? payload.email : null;
  } catch {
    return null;
  }
}

async function api<T>(accessToken: string, method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<GResult<T>> {
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res) return { ok: false, error: "No se pudo contactar a Google", status: 0 };
  if (res.status === 204) return { ok: true, data: {} as T };
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) return { ok: false, error: json.error?.message ?? `HTTP ${res.status}`, status: res.status, reauth: res.status === 401 };
  return { ok: true, data: json as T };
}

export type GCalendar = { id: string; summary: string; primary?: boolean; accessRole?: string };

export async function listCalendars(accessToken: string): Promise<GResult<GCalendar[]>> {
  const r = await api<{ items?: GCalendar[] }>(accessToken, "GET", "/users/me/calendarList", { query: { minAccessRole: "freeBusyReader" } });
  return r.ok ? { ok: true, data: r.data.items ?? [] } : r;
}

export async function freeBusy(accessToken: string, calendarIds: string[], timeMin: Date, timeMax: Date): Promise<GResult<{ start: Date; end: Date; calendarId: string }[]>> {
  const r = await api<{ calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> }>(accessToken, "POST", "/freeBusy", {
    body: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: calendarIds.map((id) => ({ id })) },
  });
  if (!r.ok) return r;
  const out: { start: Date; end: Date; calendarId: string }[] = [];
  for (const [calendarId, cal] of Object.entries(r.data.calendars ?? {})) {
    // Un calendario que Google no pudo leer NO es un calendario libre: se falla en vez de ofrecer el horario.
    if (cal.errors?.length) return { ok: false, error: `No se pudo leer la ocupación de un calendario`, status: 200 };
    for (const b of cal.busy ?? []) out.push({ start: new Date(b.start), end: new Date(b.end), calendarId });
  }
  return { ok: true, data: out };
}

export async function createSecondaryCalendar(accessToken: string, summary: string, timeZone: string): Promise<GResult<{ id: string }>> {
  return api(accessToken, "POST", "/calendars", { body: { summary, timeZone } });
}

export type GEventInput = { summary: string; description?: string; location?: string; start: Date; end: Date; timeZone: string; extendedPrivate?: Record<string, string> };

const eventBody = (e: GEventInput) => ({
  summary: e.summary,
  description: e.description,
  location: e.location,
  start: { dateTime: e.start.toISOString(), timeZone: e.timeZone },
  end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
  extendedProperties: e.extendedPrivate ? { private: e.extendedPrivate } : undefined,
});

export type GEvent = { id: string; etag?: string; status?: string; start?: { dateTime?: string }; end?: { dateTime?: string } };

export const insertEvent = (token: string, calendarId: string, e: GEventInput, eventId?: string) =>
  api<GEvent>(token, "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, { body: { ...eventBody(e), ...(eventId ? { id: eventId } : {}) } });

export const patchEvent = (token: string, calendarId: string, eventId: string, e: GEventInput) =>
  api<GEvent>(token, "PATCH", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { body: eventBody(e) });

export const getEvent = (token: string, calendarId: string, eventId: string) =>
  api<GEvent>(token, "GET", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);

export const deleteEvent = (token: string, calendarId: string, eventId: string) =>
  api<Record<string, never>>(token, "DELETE", `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);

export const watchEvents = (token: string, calendarId: string, input: { channelId: string; address: string; token: string; ttlSeconds: number }) =>
  api<{ id: string; resourceId: string; expiration?: string }>(token, "POST", `/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
    body: { id: input.channelId, type: "web_hook", address: input.address, token: input.token, params: { ttl: String(input.ttlSeconds) } },
  });

export async function stopChannel(accessToken: string, channelId: string, resourceId: string) {
  await fetch("https://www.googleapis.com/calendar/v3/channels/stop", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: channelId, resourceId }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}
