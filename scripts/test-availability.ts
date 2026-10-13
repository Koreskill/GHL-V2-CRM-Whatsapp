import assert from "node:assert/strict";
import { computeSlots, isSlotAvailable, mergeIntervals, overlaps, type AvailabilityConfig, type WorkRule } from "../src/lib/calendar/availability";

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3 todo el año
const cfg: AvailabilityConfig = { durationMin: 60, bufferMin: 30, minNoticeMin: 120, horizonDays: 7, timeZone: TZ };
// Lunes a viernes 9:00-13:00 (hora local).
const rules: WorkRule[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMin: 9 * 60, endMin: 13 * 60 }));
// Miércoles 2026-10-07 08:00 hora local = 11:00Z.
const now = new Date("2026-10-07T11:00:00Z");
const local = (iso: string) => new Date(`${iso}-03:00`);

// Sin reglas, duración 0 o sin horizonte: no se ofrece nada (no hay defaults comerciales).
assert.deepEqual(computeSlots([], cfg, [], now), []);
assert.deepEqual(computeSlots(rules, { ...cfg, durationMin: 0 }, [], now), []);
assert.deepEqual(computeSlots(rules, { ...cfg, horizonDays: 0 }, [], now), []);
assert.deepEqual(computeSlots([{ weekday: 1, startMin: 600, endMin: 500 }], cfg, [], now), [], "regla invertida descartada");

const free = computeSlots(rules, cfg, [], now);
assert.ok(free.length > 0);
// Anticipación: ahora son las 8:00 y exige 2 h => el primer horario del miércoles es las 10:00.
assert.equal(free[0].start.toISOString(), local("2026-10-07T10:00:00").toISOString());
// Nunca un horario que no cabe entero en la franja (13:00 de cierre).
assert.ok(free.every((s) => s.end.getTime() - s.start.getTime() === 3600_000));
assert.ok(!free.some((s) => s.start.toISOString() === local("2026-10-07T13:00:00").toISOString()));
// Fin de semana: nada.
assert.ok(!free.some((s) => [0, 6].includes(new Date(s.start.getTime() - 3 * 3600_000).getUTCDay())), "sin sábados ni domingos");

// Traslado: una visita de 10:00 a 11:00 con 30 min a cada lado bloquea 9:30-11:30 => no se ofrece 11:00.
const busy = [{ start: local("2026-10-07T10:00:00"), end: local("2026-10-07T11:00:00") }];
const withBusy = computeSlots(rules, cfg, busy, now).map((s) => s.start.toISOString());
assert.ok(!withBusy.includes(local("2026-10-07T10:00:00").toISOString()));
assert.ok(!withBusy.includes(local("2026-10-07T11:00:00").toISOString()), "el traslado también bloquea");
assert.ok(withBusy.includes(local("2026-10-07T12:00:00").toISOString()));
// Visita pisada parcialmente (10:30-11:30) también bloquea el horario de 11:00.
assert.ok(!computeSlots(rules, cfg, [{ start: local("2026-10-07T10:30:00"), end: local("2026-10-07T11:30:00") }], now).some((s) => s.start.getTime() === local("2026-10-07T11:00:00").getTime()));

// Horizonte: nada más allá de 7 días.
assert.ok(free.every((s) => s.end.getTime() <= now.getTime() + 7 * 24 * 3600_000));

// Revalidación justo antes de reservar.
assert.equal(isSlotAvailable(rules, cfg, [], now, local("2026-10-07T12:00:00")), true);
assert.equal(isSlotAvailable(rules, cfg, busy, now, local("2026-10-07T10:00:00")), false);
assert.equal(isSlotAvailable(rules, cfg, [], now, local("2026-10-07T12:30:00")), false, "fuera de la grilla");

// Auxiliares.
assert.equal(overlaps({ start: local("2026-10-07T10:00:00"), end: local("2026-10-07T11:00:00") }, { start: local("2026-10-07T11:00:00"), end: local("2026-10-07T12:00:00") }), false, "tocarse no es pisarse");
assert.equal(mergeIntervals([{ start: new Date(0), end: new Date(10) }, { start: new Date(5), end: new Date(20) }, { start: new Date(30), end: new Date(40) }]).length, 2);

console.log("availability: ok");
