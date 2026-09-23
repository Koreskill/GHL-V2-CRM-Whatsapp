// Zona fija: el contenedor corre en UTC y el navegador en hora local; así servidor y cliente coinciden.
const TZ = "America/Argentina/Buenos_Aires";

const time = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const day = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const longDay = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });

export const formatTime = (iso: string) => time.format(new Date(iso));

export function formatListDate(iso: string | null, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (dayKey.format(d) === dayKey.format(now)) return time.format(d);
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (dayKey.format(d) === dayKey.format(yesterday)) return "Ayer";
  return day.format(d);
}

export const dayOf = (iso: string) => dayKey.format(new Date(iso));

export function formatDayDivider(iso: string, now = new Date()) {
  const key = dayOf(iso);
  if (key === dayKey.format(now)) return "Hoy";
  if (key === dayKey.format(new Date(now.getTime() - 86_400_000))) return "Ayer";
  const label = longDay.format(new Date(iso));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function formatRemaining(expiresAt: string, now = Date.now()) {
  const ms = new Date(expiresAt).getTime() - now;
  if (ms <= 0) return "vencida";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
