// Pruebas SIN base de la operación: seguimientos (horarios, ventana, tope diario), baja de mensajes,
// criterio legible de segmentos, espera de la cola y estados de una inmobiliaria.
import assert from "node:assert/strict";
import { localDay, nextSendTime, renderStep, validateSteps } from "../src/lib/followups/logic";
import { isOptOutRequest } from "../src/lib/crm/opt-out";
import { describeFilters } from "../src/lib/crm/describe-filters";
import { parseContactFilters, contactFiltersToParams } from "../src/lib/crm/contact-filters";
import { backoffMs } from "../src/lib/jobs/queue";
import { accessAllowed, automationAllowed, ingestAllowed, normalizeOrgStatus } from "../src/lib/agency/lifecycle";
import { splitAudience } from "../src/lib/campaigns/cost";
import { computeWindow } from "../src/lib/inbox/window";

const TZ = "America/Argentina/Buenos_Aires"; // UTC-3 sin horario de verano
const at = (iso: string) => new Date(iso);
const base = {
  lastAutomatedAt: null,
  minGapMinutes: 60,
  timeZone: TZ,
  allowedStartHour: 8,
  allowedEndHour: 22,
  maxPerDay: 5,
  sentPerDay: {},
  windowMarginMinutes: 15,
};

// ── nextSendTime ────────────────────────────────────────────────────────────
{
  // 15:00 ART deseado, ventana hasta mañana: sale a las 15:00.
  const now = at("2026-10-20T17:00:00Z"); // 14:00 ART
  const r = nextSendTime({ ...base, now, desiredAt: at("2026-10-20T18:00:00Z"), windowExpiresAt: at("2026-10-21T12:00:00Z") });
  assert.equal(r.at?.toISOString(), "2026-10-20T18:00:00.000Z", "sale a la hora deseada si está en horario");
}
{
  // 23:30 ART deseado: fuera de horario -> 08:00 ART del día siguiente (11:00Z).
  const now = at("2026-10-21T02:00:00Z");
  const r = nextSendTime({ ...base, now, desiredAt: at("2026-10-21T02:30:00Z"), windowExpiresAt: at("2026-10-21T20:00:00Z") });
  assert.equal(r.at?.toISOString(), "2026-10-21T11:00:00.000Z", "fuera de horario corre al inicio del horario siguiente");
}
{
  // Corrido a las 08:00 pero la ventana vence 07:50 ART: no entra -> no se programa.
  const now = at("2026-10-21T02:00:00Z");
  const r = nextSendTime({ ...base, now, desiredAt: at("2026-10-21T02:30:00Z"), windowExpiresAt: at("2026-10-21T10:50:00Z") });
  assert.equal(r.at, null);
  assert.equal(r.at === null && r.reason, "no_entra_en_la_ventana", "un paso que no entra en la ventana no sale");
}
{
  // Ventana ya vencida.
  const now = at("2026-10-21T15:00:00Z");
  const r = nextSendTime({ ...base, now, desiredAt: now, windowExpiresAt: at("2026-10-21T14:59:00Z") });
  assert.equal(r.at === null && r.reason, "ventana_cerrada", "ventana vencida impide el envío");
}
{
  // Margen: deseado 10 min antes del cierre con margen 15 -> no sale.
  const now = at("2026-10-21T15:00:00Z");
  const r = nextSendTime({ ...base, now, desiredAt: at("2026-10-21T15:50:00Z"), windowExpiresAt: at("2026-10-21T16:00:00Z") });
  assert.equal(r.at, null, "respeta el margen antes del cierre");
}
{
  // Separación mínima: último automático hace 10 min, gap 60 -> +50 min.
  const now = at("2026-10-21T15:00:00Z");
  const r = nextSendTime({ ...base, now, desiredAt: now, lastAutomatedAt: at("2026-10-21T14:50:00Z"), windowExpiresAt: at("2026-10-22T10:00:00Z") });
  assert.equal(r.at?.toISOString(), "2026-10-21T15:50:00.000Z", "respeta la separación mínima");
}
{
  // Tope diario alcanzado hoy -> mañana 08:00 ART, si la ventana lo permite.
  const now = at("2026-10-21T15:00:00Z"); // 12:00 ART
  const today = localDay(now, TZ);
  const r = nextSendTime({ ...base, now, desiredAt: now, sentPerDay: { [today]: 5 }, windowExpiresAt: at("2026-10-22T14:00:00Z") });
  assert.equal(r.at?.toISOString(), "2026-10-22T11:00:00.000Z", "con el tope del día pasa al día siguiente");
  const r2 = nextSendTime({ ...base, now, desiredAt: now, sentPerDay: { [today]: 5 }, windowExpiresAt: at("2026-10-22T09:00:00Z") });
  assert.equal(r2.at, null, "si el día siguiente no entra en la ventana, no sale");
}
{
  const r = nextSendTime({ ...base, allowedStartHour: 22, allowedEndHour: 8, desiredAt: new Date(), windowExpiresAt: new Date(Date.now() + 3600_000) });
  assert.equal(r.at === null && r.reason, "horario_invalido");
}

// ── renderStep / validateSteps ──────────────────────────────────────────────
assert.equal(renderStep("Hola {nombre}, ¿pudiste verla?", "María José"), "Hola María, ¿pudiste verla?");
assert.equal(renderStep("Hola {nombre}, ¿pudiste verla?", null), "Hola, ¿pudiste verla?", "sin nombre se saca la variable");
assert.equal(renderStep("   ", "Ana"), null);
assert.equal(validateSteps([]), "La secuencia necesita al menos un paso.");
assert.match(validateSteps([{ delayMinutes: 2, body: "x" }]) ?? "", /mínima es 5 minutos/);
assert.match(validateSteps([{ delayMinutes: 24 * 60, body: "x" }]) ?? "", /23 h/);
assert.equal(validateSteps([{ delayMinutes: 120, body: "Hola" }]), null);

// ── Baja ────────────────────────────────────────────────────────────────────
for (const t of ["BAJA", "baja por favor", "Stop", "No me escriban más", "no quiero recibir más mensajes!", "Desuscribirme"]) {
  assert.equal(isOptOutRequest(t), true, `baja: ${t}`);
}
for (const t of ["¿La baja de precio sigue?", "quiero ver la casa", "", null, "no me escriban por whatsapp, llamenme al 11 5555 5555 cuando puedan por favor gracias"]) {
  assert.equal(isOptOutRequest(t as string | null), false, `no es baja: ${t}`);
}

// ── Filtros: etiqueta, grupo y baja ida y vuelta + criterio legible ─────────
{
  const id = "0b9c2f5e-4b8f-4a5e-9d8a-1c2b3d4e5f60";
  const f = parseContactFilters({ etiqueta: id, grupo: id, baja: "no", temperatura: "caliente", canal: "x" });
  assert.equal(f.labelId, id);
  assert.equal(f.groupId, id);
  assert.equal(f.optOut, "no");
  assert.equal(parseContactFilters({ etiqueta: "no-es-uuid" }).labelId, undefined, "un id inválido se ignora");
  const back = parseContactFilters(Object.fromEntries(contactFiltersToParams(f)));
  assert.deepEqual(back, f, "los filtros nuevos van y vuelven por la URL");
  const text = describeFilters(f, { labels: new Map([[id, "Inversor"]]), groups: new Map([[id, "Feria"]]) }).join(", ");
  assert.match(text, /etiqueta «Inversor»/);
  assert.match(text, /grupo «Feria»/);
  assert.match(text, /sin baja/);
}

// ── Audiencia: la baja excluye ─────────────────────────────────────────────
{
  const { eligible, excluded } = splitAudience(
    [
      { contactId: "a", name: "Ana", conversationId: "c1" },
      { contactId: "b", name: "Beto", conversationId: "c2", optedOut: true },
      { contactId: "c", name: "Caro", conversationId: null },
    ],
    [],
  );
  assert.deepEqual(eligible.map((e) => e.contactId), ["a"]);
  assert.deepEqual(excluded, { baja: 1, sin_whatsapp: 1 });
}

// ── Cola: espera creciente con tope ─────────────────────────────────────────
assert.equal(backoffMs(1), 30_000);
assert.equal(backoffMs(2), 60_000);
assert.equal(backoffMs(4), 240_000);
assert.equal(backoffMs(20), 30 * 60_000, "tope de 30 minutos");

// ── Estados de una inmobiliaria ────────────────────────────────────────────
assert.equal(normalizeOrgStatus(undefined), "activa");
assert.equal(normalizeOrgStatus("cualquier cosa"), "activa");
assert.equal(automationAllowed("suspendida"), false, "suspendida no ejecuta nada automático");
assert.equal(ingestAllowed("suspendida"), true, "suspendida guarda lo entrante");
assert.equal(accessAllowed("suspendida"), false);
assert.equal(ingestAllowed("eliminada"), false);

// ── Ventana: vencida a las 24 h (WhatsApp) ─────────────────────────────────
{
  const now = Date.parse("2026-10-21T12:00:00Z");
  assert.equal(computeWindow("whatsapp", new Date(now - 23 * 3600_000), now).state, "open");
  assert.equal(computeWindow("whatsapp", new Date(now - 25 * 3600_000), now).state, "template_only", "fuera de 24 h solo plantilla");
}

console.log("operacion: OK");
