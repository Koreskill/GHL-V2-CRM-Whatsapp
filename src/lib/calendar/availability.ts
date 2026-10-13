import { wallTimeToDate } from "@/lib/tz";

// Motor de disponibilidad: FUNCIONES PURAS, sin base ni red. Recibe las reglas, lo ocupado y "ahora",
// y devuelve los huecos. Así se prueba entero y se reutiliza igual para el agente, la UI y la reserva.
//
// Ninguna cifra de acá es un default comercial: la duración, los traslados, la anticipación y el horizonte
// los define cada inmobiliaria en `calendar_settings`. Sin configurar no se ofrece ningún horario.

export type Interval = { start: Date; end: Date };

export type WorkRule = {
  /** 0 = domingo … 6 = sábado, en la zona de la inmobiliaria. */
  weekday: number;
  /** Minutos desde las 00:00 locales. */
  startMin: number;
  endMin: number;
};

export type AvailabilityConfig = {
  durationMin: number;
  /** Traslado/margen entre visitas: se respeta a ambos lados de cada ocupación. */
  bufferMin: number;
  minNoticeMin: number;
  horizonDays: number;
  timeZone: string;
  /** Cada cuánto arrancan los horarios ofrecidos (por defecto, la duración). */
  stepMin?: number;
};

export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

const pad = (n: number) => String(n).padStart(2, "0");

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Une intervalos que se pisan o se tocan, para comparar contra menos elementos. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].filter((i) => i.end > i.start).sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) {
      if (i.end > last.end) last.end = i.end;
    } else out.push({ start: new Date(i.start), end: new Date(i.end) });
  }
  return out;
}

export function validRules(rules: WorkRule[]): WorkRule[] {
  return rules.filter((r) => Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6 && r.startMin >= 0 && r.endMin <= 24 * 60 && r.endMin > r.startMin);
}

/**
 * Horarios libres. Un horario se ofrece si cabe entero en una franja laboral, respeta la anticipación y el
 * horizonte, y no pisa (con su traslado) nada de lo ocupado. `busy` incluye visitas, bloqueos y ocupación
 * externa: acá no importa de dónde vienen.
 */
export function computeSlots(rules: WorkRule[], config: AvailabilityConfig, busy: Interval[], now: Date): Interval[] {
  const { durationMin, bufferMin, minNoticeMin, horizonDays, timeZone } = config;
  if (!(durationMin > 0) || horizonDays <= 0) return [];
  const step = config.stepMin && config.stepMin > 0 ? config.stepMin : durationMin;
  const ok = validRules(rules);
  if (ok.length === 0) return [];

  const buffered = mergeIntervals(
    busy.map((b) => ({ start: new Date(b.start.getTime() - bufferMin * 60_000), end: new Date(b.end.getTime() + bufferMin * 60_000) })),
  );
  const earliest = new Date(now.getTime() + minNoticeMin * 60_000);
  const latest = new Date(now.getTime() + horizonDays * 24 * 3600_000);

  const slots: Interval[] = [];
  const first = localParts(now, timeZone);
  // Se recorre un día local por vez: así los cambios de horario de verano no corren las franjas.
  for (let offset = 0; offset <= horizonDays + 1; offset++) {
    const day = new Date(Date.UTC(first.y, first.m - 1, first.d + offset));
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const weekday = day.getUTCDay();
    for (const rule of ok.filter((r) => r.weekday === weekday)) {
      for (let startMin = rule.startMin; startMin + durationMin <= rule.endMin; startMin += step) {
        const start = wallTimeToDate(`${y}-${pad(m)}-${pad(d)}T${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`, timeZone);
        if (!start) continue;
        const slot = { start, end: new Date(start.getTime() + durationMin * 60_000) };
        if (slot.start < earliest || slot.end > latest) continue;
        if (buffered.some((b) => overlaps(slot, b))) continue;
        slots.push(slot);
      }
    }
  }
  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/** ¿Este horario exacto sigue siendo ofrecible? Es lo que se revalida justo antes de reservar. */
export function isSlotAvailable(rules: WorkRule[], config: AvailabilityConfig, busy: Interval[], now: Date, start: Date): boolean {
  return computeSlots(rules, config, busy, now).some((s) => s.start.getTime() === start.getTime());
}
