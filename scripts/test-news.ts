import assert from "node:assert/strict";
import { parseEventInput } from "../src/lib/news/input";
import {
  canManage, canSee, dayKey, expandOccurrences, monthGrid, occurrencesIn, prioritizeNews, weekStart,
  type NewsEvent, type Viewer,
} from "../src/lib/news/logic";

const NET_COWIN = "11111111-1111-4111-8111-111111111111";
const NET_OTRA = "22222222-2222-4222-8222-222222222222";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let n = 0;
const ev = (p: Partial<NewsEvent>): NewsEvent => ({
  id: `e${++n}`, scope: "network", networkId: NET_COWIN, organizationId: null, title: "Evento", description: null, eventType: "announcement",
  startAt: new Date("2026-10-10T15:00:00Z"), endAt: null, allDay: false, location: null, meetingUrl: null, propertyId: null, assignedUserIds: [],
  reminderAt: null, recurrence: "none", recurrenceUntil: null, createdBy: "u1", createdAt: new Date(), updatedAt: new Date(), ...p,
});

// Quiénes miran.
const miembroDeCowin: Viewer = { isAgencyAdmin: false, acting: false, orgId: ORG_A, networkIds: [NET_COWIN] };
const miembroSinRed: Viewer = { isAgencyAdmin: false, acting: false, orgId: ORG_B, networkIds: [] };
const agencia: Viewer = { isAgencyAdmin: true, acting: false, orgId: "home", networkIds: [NET_COWIN, NET_OTRA] };
const agenciaEnClienteA: Viewer = { isAgencyAdmin: true, acting: true, orgId: ORG_A, networkIds: [NET_COWIN] };

const red = ev({ scope: "network", networkId: NET_COWIN });
const redAjena = ev({ scope: "network", networkId: NET_OTRA });
const interno = ev({ scope: "internal", networkId: null });
const clienteA = ev({ scope: "client", networkId: null, organizationId: ORG_A });
const clienteB = ev({ scope: "client", networkId: null, organizationId: ORG_B });

// 1. Un evento de la red lo ve un miembro válido de esa red (y no uno de otra red ni sin red).
assert.equal(canSee(miembroDeCowin, red), true);
assert.equal(canSee(miembroDeCowin, redAjena), false, "otra red no");
assert.equal(canSee(miembroSinRed, red), false, "sin red no");

// 2. Un evento interno queda oculto para quien no es del equipo interno.
assert.equal(canSee(miembroDeCowin, interno), false);
assert.equal(canSee(miembroSinRed, interno), false);
assert.equal(canSee(agencia, interno), true);
// Un cliente externo tampoco ve lo "de cliente", ni siquiera el suyo: es solo para el equipo interno.
assert.equal(canSee(miembroDeCowin, clienteA), false);

// 3. Un evento de cliente se ve solo en el contexto de ESE cliente.
assert.equal(canSee(agenciaEnClienteA, clienteA), true);
assert.equal(canSee(agencia, clienteA), true, "la agencia fuera de un cliente ve todos");

// 4. Los eventos de otro cliente nunca se filtran dentro del contexto de un cliente.
assert.equal(canSee(agenciaEnClienteA, clienteB), false);
assert.equal(canSee({ ...agenciaEnClienteA, orgId: ORG_B }, clienteA), false);
// Y dentro de un cliente solo se ven las redes de ESE cliente.
assert.equal(canSee(agenciaEnClienteA, redAjena), false);
// Un destino mal formado no se ve.
assert.equal(canSee(agencia, ev({ scope: "network", networkId: null })), false);
assert.equal(canSee(agencia, ev({ scope: "client", networkId: null, organizationId: null })), false);

// Solo el equipo interno gestiona.
assert.equal(canManage(agencia), true);
assert.equal(canManage(miembroDeCowin), false);

// La lista visible, aplicando canSee, no deja pasar nada de más.
const todos = [red, redAjena, interno, clienteA, clienteB];
assert.deepEqual(todos.filter((e) => canSee(miembroDeCowin, e)).map((e) => e.id), [red.id]);
assert.deepEqual(todos.filter((e) => canSee(agenciaEnClienteA, e)).map((e) => e.id), [red.id, interno.id, clienteA.id]);

// ── Recurrencia ──
const semanal = ev({ startAt: new Date("2026-10-05T13:00:00Z"), recurrence: "weekly", recurrenceUntil: new Date("2026-10-31T00:00:00Z") });
const oct = expandOccurrences(semanal, new Date("2026-10-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z"));
assert.deepEqual(oct.map((o) => o.startAt.toISOString().slice(0, 10)), ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"], "respeta la fecha de fin");
const mensual31 = ev({ startAt: new Date("2026-01-31T15:00:00Z"), recurrence: "monthly" });
assert.deepEqual(
  expandOccurrences(mensual31, new Date("2026-02-01T00:00:00Z"), new Date("2026-04-01T00:00:00Z")).map((o) => o.startAt.toISOString().slice(0, 10)),
  ["2026-02-28", "2026-03-31"],
  "un evento del 31 cae el último día del mes, no salta de mes",
);
assert.equal(expandOccurrences(ev({}), new Date("2026-11-01T00:00:00Z"), new Date("2026-12-01T00:00:00Z")).length, 0, "fuera del rango no aparece");
const largo = ev({ startAt: new Date("2026-10-09T12:00:00Z"), endAt: new Date("2026-10-12T12:00:00Z") });
assert.equal(expandOccurrences(largo, new Date("2026-10-11T00:00:00Z"), new Date("2026-10-13T00:00:00Z")).length, 1, "un evento largo aparece si se solapa");

// ── Calendario: el mes se dibuja de lunes a domingo, en hora de Argentina ──
const grid = monthGrid("2026-10");
assert.equal(grid[0], "2026-09-28", "octubre 2026 empieza un jueves: la grilla arranca el lunes anterior");
assert.equal(grid.length % 7, 0);
assert.equal(weekStart("2026-10-04"), "2026-09-28", "el domingo pertenece a la semana que empezó el lunes");
assert.equal(dayKey(new Date("2026-10-10T02:30:00Z")), "2026-10-09", "02:30 UTC es la noche del día anterior en Argentina");

// ── Prioridad del dashboard ──
const now = new Date("2026-10-10T15:00:00Z");
const mk = (p: Partial<NewsEvent>) => ev({ id: p.title ?? "x", ...p });
const pendiente = mk({ title: "pendiente", eventType: "reminder", startAt: new Date("2026-10-08T15:00:00Z") });
const hoy = mk({ title: "hoy", eventType: "meeting", startAt: new Date("2026-10-10T20:00:00Z") });
const manana = mk({ title: "mañana", eventType: "training", startAt: new Date("2026-10-11T15:00:00Z") });
const luego = mk({ title: "luego", eventType: "activity", startAt: new Date("2026-10-20T15:00:00Z") });
const anuncio = mk({ title: "anuncio", eventType: "announcement", startAt: new Date("2026-10-07T15:00:00Z") });
const viejo = mk({ title: "viejo", eventType: "meeting", startAt: new Date("2026-08-01T15:00:00Z") });
const orden = prioritizeNews(occurrencesIn([luego, manana, hoy, pendiente, anuncio, viejo], new Date("2026-10-01T00:00:00Z"), new Date("2026-11-30T00:00:00Z")), now, 5);
assert.deepEqual(orden.map((i) => i.occurrence.event.title), ["pendiente", "hoy", "mañana", "luego", "anuncio"], "vencidos, hoy, próximos y anuncios, en ese orden");
assert.equal(orden[0].reason, "vencido");
assert.ok(!orden.some((i) => i.occurrence.event.title === "viejo"), "lo viejo no aparece");
assert.equal(prioritizeNews(occurrencesIn([luego, manana, hoy, pendiente, anuncio], new Date("2026-10-01T00:00:00Z"), new Date("2026-11-30T00:00:00Z")), now, 3).length, 3, "el límite se respeta");

// ── Validación del formulario ──
const form = (o: Record<string, unknown>) => parseEventInput((k) => o[k]);
const okBase = { title: "Capacitación", eventType: "training", scope: "network", networkId: NET_COWIN, startAt: "2026-10-12T10:00" };
const good = form(okBase);
assert.ok(good.ok);
assert.equal(good.ok && good.value.startAt.toISOString(), "2026-10-12T13:00:00.000Z", "la hora se interpreta en Argentina");
assert.equal(form({ ...okBase, title: " " }).ok, false);
assert.equal(form({ ...okBase, scope: "todos" }).ok, false);
assert.equal(form({ ...okBase, networkId: "x" }).ok, false, "una red necesita su destino");
assert.equal(form({ ...okBase, scope: "client", organizationId: "" }).ok, false, "un cliente necesita su destino");
const interna = form({ ...okBase, scope: "internal" });
assert.ok(interna.ok && interna.value.networkId === null && interna.value.organizationId === null, "interno no lleva destino");
const cli = form({ ...okBase, scope: "client", organizationId: ORG_A, networkId: NET_COWIN });
assert.ok(cli.ok && cli.value.networkId === null && cli.value.organizationId === ORG_A, "cada alcance usa solo su destino");
assert.equal(form({ ...okBase, meetingUrl: "javascript:alert(1)" }).ok, false);
assert.equal(form({ ...okBase, meetingUrl: "http://zoom.us/j/1" }).ok, false);
assert.equal(form({ ...okBase, endAt: "2026-10-12T09:00" }).ok, false, "el fin no puede ser antes del inicio");
const todoElDia = form({ ...okBase, allDay: "on", startAt: "2026-10-12T17:45", endAt: "2026-10-12T18:00" });
assert.ok(todoElDia.ok && todoElDia.value.startAt.toISOString() === "2026-10-12T03:00:00.000Z" && todoElDia.value.endAt === null, "todo el día arranca a las 00:00");
assert.equal(form({ ...okBase, recurrence: "cada-tanto" }).ok, false);

console.log("news: OK");
