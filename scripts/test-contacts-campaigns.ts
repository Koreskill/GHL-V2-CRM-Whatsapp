import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { contactFiltersToParams, contactWhere, parseContactFilters } from "../src/lib/crm/contact-filters";
import { estimateCost, personalizeParams, splitAudience } from "../src/lib/campaigns/cost";

const dialect = new PgDialect();
const render = (f: ReturnType<typeof parseContactFilters>) => dialect.sqlToQuery(contactWhere("org-1", f));

// Filtros: lo desconocido se ignora y ida y vuelta por la URL no cambia nada.
const f = parseContactFilters({ channel: "tiktok", temperatura: "caliente", desde: "2026-13-99", presupuestoMin: "100.000", moneda: "EUR", propiedad: "no-uuid", operacion: "venta" });
assert.equal(f.channel, undefined);
assert.equal(f.temperature, "caliente");
assert.equal(f.budgetMin, 100000);
assert.equal(f.currency, undefined);
assert.equal(f.propertyId, undefined);
assert.equal(f.from, undefined, "una fecha inválida se ignora");
assert.equal(contactFiltersToParams(parseContactFilters(Object.fromEntries(contactFiltersToParams(f)))).toString(), contactFiltersToParams(f).toString());

// SQL: siempre filtra por organización, las relaciones van en EXISTS (sin duplicar contactos) y nada se interpola.
const q = render(parseContactFilters({ propiedad: "0f8fad5b-d9cb-469f-a165-70867728950e", interes: "1", campo: "visita", desde: "2026-01-01", hasta: "2026-01-31", presupuestoMax: "200000", moneda: "USD", q: "a%b'; drop table contacts;--" }));
assert.match(q.sql, /c\.organization_id = \$1/);
assert.ok(!/join\s+deals.*where.*group by/i.test(q.sql), "sin joins que multipliquen filas");
assert.ok((q.sql.match(/organization_id = \$/g) ?? []).length >= 4, "cada subconsulta repite la organización");
assert.ok(!q.sql.includes("drop table"), "el texto del usuario va como parámetro");
assert.ok(q.params.includes("org-1"));

// Costo: fórmula explicada y redondeo a 2 decimales.
const cost = estimateCost({ count: 100, unitPrice: 0.0618, surchargePct: 10, taxPct: 21 });
assert.equal(cost.subtotal, 6.18);
assert.equal(cost.surcharge, 0.62);
assert.equal(cost.tax, 1.43);
assert.equal(cost.total, 8.23);
assert.match(cost.formula, /100 × 0.0618/);
assert.equal(estimateCost({ count: 0, unitPrice: 1, surchargePct: 0, taxPct: 0 }).total, 0);

// Variables: {nombre} por contacto, y una variable vacía nunca se envía.
assert.deepEqual(personalizeParams(["Hola {nombre}", "x"], "Ana María Pérez"), ["Hola Ana", "x"]);
assert.equal(personalizeParams(["{nombre}"], null), null);
const { eligible, excluded } = splitAudience(
  [
    { contactId: "1", name: "Ana", conversationId: "c1" },
    { contactId: "2", name: null, conversationId: "c2" },
    { contactId: "3", name: "Luis", conversationId: null },
  ],
  ["{nombre}"],
);
assert.equal(eligible.length, 1);
assert.deepEqual(excluded, { variable_vacia: 1, sin_whatsapp: 1 });

console.log("contacts/campaigns: OK");
