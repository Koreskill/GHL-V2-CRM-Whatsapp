// Cuándo puede salir el próximo paso de un seguimiento. Lógica PURA (se prueba sin base).
//
// "Aprovechar cada minuto" = programar con precisión dentro del tiempo que el canal deja: el paso sale
// lo antes posible respetando, en este orden:
//   1. la espera configurada desde el último evento relevante;
//   2. la separación mínima con el último mensaje automático a esa conversación;
//   3. las horas permitidas en la zona horaria de la secuencia;
//   4. el máximo por día (día local);
//   5. el vencimiento de la ventana del canal menos un margen. Si no entra, NO se programa.
// La ventana se vuelve a verificar al enviar (run.ts): esto solo calcula.

export type ScheduleInput = {
  /** Instante deseado: ancla + espera del paso. */
  desiredAt: Date;
  /** Último mensaje automático (bot, campaña o seguimiento) a esta conversación. */
  lastAutomatedAt: Date | null;
  minGapMinutes: number;
  timeZone: string;
  allowedStartHour: number; // 0-23
  allowedEndHour: number; // 1-24, exclusiva
  maxPerDay: number;
  /** Seguimientos ya enviados a esta conversación por día local ("yyyy-mm-dd" -> cantidad). */
  sentPerDay: Record<string, number>;
  /** Fin de la ventana de texto libre (null = no hay ventana abierta). */
  windowExpiresAt: Date | null;
  windowMarginMinutes: number;
  now?: Date;
};

export type ScheduleResult = { at: Date } | { at: null; reason: "ventana_cerrada" | "no_entra_en_la_ventana" | "horario_invalido" };

const MIN = 60_000;

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

export const localDay = (at: Date, timeZone: string) => localParts(at, timeZone).day;

/** El primer instante >= `at` cuya hora local sea exactamente `hour`:00 (avanza de a minutos de forma acotada). */
function nextLocalHour(at: Date, timeZone: string, hour: number): Date {
  const p = localParts(at, timeZone);
  // Minutos hasta la próxima ocurrencia de hour:00 en hora local.
  let delta = (hour - p.hour) * 60 - p.minute;
  if (delta <= 0) delta += 24 * 60;
  const candidate = new Date(Math.floor(at.getTime() / MIN) * MIN + delta * MIN);
  // Ajuste fino por cambios de horario: si quedó corrido, se corrige una vez.
  const q = localParts(candidate, timeZone);
  return q.hour === hour ? candidate : new Date(candidate.getTime() + (hour - q.hour) * 60 * MIN);
}

export function nextSendTime(input: ScheduleInput): ScheduleResult {
  const now = input.now ?? new Date();
  const { allowedStartHour: start, allowedEndHour: end } = input;
  if (!(start >= 0 && end <= 24 && start < end) || input.maxPerDay < 1) return { at: null, reason: "horario_invalido" };
  if (!input.windowExpiresAt || input.windowExpiresAt.getTime() <= now.getTime()) return { at: null, reason: "ventana_cerrada" };

  const deadline = input.windowExpiresAt.getTime() - input.windowMarginMinutes * MIN;
  let t = Math.max(input.desiredAt.getTime(), now.getTime());
  if (input.lastAutomatedAt) t = Math.max(t, input.lastAutomatedAt.getTime() + input.minGapMinutes * MIN);

  // A lo sumo una semana de corrimientos (en la práctica la ventana corta mucho antes).
  for (let i = 0; i < 14; i++) {
    if (t > deadline) return { at: null, reason: "no_entra_en_la_ventana" };
    const at = new Date(t);
    const p = localParts(at, input.timeZone);
    if (p.hour < start) {
      t = nextLocalHour(at, input.timeZone, start).getTime();
      continue;
    }
    if (p.hour >= end) {
      t = nextLocalHour(at, input.timeZone, start).getTime();
      continue;
    }
    if ((input.sentPerDay[p.day] ?? 0) >= input.maxPerDay) {
      // Tope del día alcanzado: al inicio del horario del día siguiente.
      t = nextLocalHour(new Date(t + 60 * MIN), input.timeZone, start).getTime();
      if (localParts(new Date(t), input.timeZone).day === p.day) t += 24 * 60 * MIN;
      continue;
    }
    return { at };
  }
  return { at: null, reason: "no_entra_en_la_ventana" };
}

/** Reemplaza {nombre} por el primer nombre. Si el texto queda vacío o el nombre falta y se usa, null. */
export function renderStep(body: string, name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0] ?? "";
  if (/\{nombre\}/i.test(body) && !first) {
    // Sin nombre se saca la variable con su coma/espacio, en vez de mandar "Hola , ...".
    const cleaned = body.replace(/[ ,]*\{nombre\}/gi, "").replace(/\s{2,}/g, " ").trim();
    return cleaned || null;
  }
  const out = body.replace(/\{nombre\}/gi, first).trim();
  return out || null;
}

export type StepDraft = { delayMinutes: number; body: string };

/** Valida los pasos que carga el admin. Devuelve el primer error legible o null. */
export function validateSteps(steps: StepDraft[]): string | null {
  if (!steps.length) return "La secuencia necesita al menos un paso.";
  if (steps.length > 10) return "Máximo 10 pasos por secuencia.";
  for (const [i, s] of steps.entries()) {
    if (!Number.isInteger(s.delayMinutes) || s.delayMinutes < 5) return `Paso ${i + 1}: la espera mínima es 5 minutos.`;
    if (s.delayMinutes > 23 * 60) return `Paso ${i + 1}: la espera no puede superar 23 h (la ventana de WhatsApp es de 24 h).`;
    if (!s.body.trim()) return `Paso ${i + 1}: falta el texto.`;
    if (s.body.length > 1000) return `Paso ${i + 1}: el texto es demasiado largo (máximo 1000 caracteres).`;
  }
  return null;
}
