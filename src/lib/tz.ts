// "2026-09-30T15:30" (lo que manda un input datetime-local) es una hora de PARED sin zona. Interpretarla
// con la zona del servidor (en Dokploy es UTC) corre la visita varias horas. Acá se interpreta en la
// zona de la inmobiliaria, que es la que ve quien la carga.
export const APP_TIME_ZONE = "America/Argentina/Buenos_Aires";

function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Hora de pared en `timeZone` -> instante. Devuelve null si el texto no es una fecha real. */
export function wallTimeToDate(raw: string, timeZone: string = APP_TIME_ZONE): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) {
    // Un ISO completo con zona ("...Z" o "+03:00") ya es un instante.
    const d = new Date(raw);
    return /[zZ]|[+-]\d{2}:\d{2}$/.test(raw.trim()) && !Number.isNaN(d.getTime()) ? d : null;
  }
  const [y, mo, d, h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)];
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(guess);
  // Rechaza fechas imposibles como 31 de febrero (Date.UTC las "corrige" en silencio).
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59) return null;
  // Se ajusta por el desfase de esa zona en ese momento (dos pasadas cubren los cambios de horario de verano).
  let ts = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  ts = guess - offsetMinutes(new Date(ts), timeZone) * 60_000;
  return new Date(ts);
}
