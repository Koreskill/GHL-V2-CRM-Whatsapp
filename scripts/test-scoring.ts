import assert from "node:assert/strict";
import { __parseExtractionForTests as parseExtraction } from "../src/lib/agent/triage/extract";
import { selectCandidates, type NetworkRow, type OwnRow } from "../src/lib/scoring/candidates";
import { SCORING, bandOf, validateWeights } from "../src/lib/scoring/config";
import { emptyFlat } from "../src/lib/scoring/flat";
import { parseManualInput } from "../src/lib/scoring/input";
import { applyChanges, lockedKeys, manualChanges, profileFromStored, type LeadProfile, type StoredCriteria } from "../src/lib/scoring/profile";
import { scoreCandidate, type Candidate } from "../src/lib/scoring/score";

const meta = { strict: null as boolean | null, confidence: 0.9, source: "ai" as const, messageId: "m1", updatedAt: "2026-10-02T00:00:00Z" };
const crit = <T,>(value: T, extra: Partial<typeof meta> = {}) => ({ value, ...meta, ...extra });

const house: Candidate = {
  kind: "cartera", id: "p1", operation: "venta", propertyType: "casa", zone: "Funes", city: "Funes",
  price: 240000, currency: "USD", bedrooms: 3, bathrooms: 2, areaM2: 180, parking: 1, amenities: ["pileta", "jardin"],
};
const base: LeadProfile = { currency: null };
const must = (p: LeadProfile, c: Candidate) => {
  const r = scoreCandidate(p, c);
  assert.ok(r, "debería puntuar");
  return r;
};

// Los pesos suman 100 y las bandas son configurables.
assert.equal(validateWeights(), 100);
assert.equal(bandOf(SCORING.bands.strong), "strong");
assert.equal(bandOf(79), "possible");
assert.equal(bandOf(45), "weak");
assert.equal(bandOf(10), "low");

// 9. Lo que no dijo no penaliza: mismo puntaje con o sin datos desconocidos en la propiedad.
const soloZona: LeadProfile = { ...base, zones: crit(["Funes"]) };
const full = must(soloZona, house);
const sinDatos = must(soloZona, { ...house, bedrooms: null, bathrooms: null, areaM2: null, price: null, amenities: [] });
assert.equal(full.score, 100);
assert.equal(sinDatos.score, 100, "datos que faltan no restan");
assert.ok(full.missing.includes("Presupuesto sin definir"), "se anota como dato que falta");

// 10. Zona exacta suma frente a otra zona.
const otraZona = must(soloZona, { ...house, zone: "Rosario", city: "Rosario" });
assert.ok(full.score > otraZona.score);
assert.ok(otraZona.conflicting.some((c) => c.includes("Otra zona")));

// 11. Conflicto duro de presupuesto: baja fuerte y topa el puntaje.
const conPresupuesto = (strict: boolean | null, flexible?: boolean): LeadProfile => ({
  ...base, zones: crit(["Funes"]), budgetMax: crit(250000, { strict }), ...(flexible !== undefined ? { budgetFlexible: crit(flexible) } : {}),
});
const caro = { ...house, price: 400000 };
const duro = must(conPresupuesto(true), caro);
assert.ok(duro.score <= SCORING.hardConflictCap, `duro topado (${duro.score})`);
assert.equal(duro.hardConflicts.length, 1);
assert.ok(duro.score < must(conPresupuesto(true), house).score - 40, "reduce con fuerza");

// Máximo sin aclarar si es estricto: sigue siendo blando (solo pierde los puntos del presupuesto).
const blando = must(conPresupuesto(null), caro);
assert.equal(blando.hardConflicts.length, 0);
assert.ok(blando.score > duro.score);

// 12. Flexible vs estricto: 8% sobre el máximo.
const apenas = { ...house, price: 270000 };
const estricto = must(conPresupuesto(true), apenas);
const flexible = must(conPresupuesto(null, true), apenas);
assert.ok(flexible.score > estricto.score, "flexible se comporta distinto");
assert.ok(flexible.matched.some((m) => m.includes("flexible")));
// Sin evidencia de flexibilidad no se supone: un 8% sobre el máximo cuenta como superado.
assert.ok(must(conPresupuesto(null), apenas).conflicting.some((c) => c.includes("Supera")));
// Flexible no alcanza para cualquier exceso (tolerancia 15%).
assert.ok(must(conPresupuesto(null, true), { ...house, price: 400000 }).conflicting.some((c) => c.includes("Supera")));

// 13. Un amenity requerido cambia el ranking (el ejemplo "la pileta es indispensable").
const A: Candidate = { ...house, id: "A", amenities: ["jardin", "cochera"], parking: 1 };
const B: Candidate = { ...house, id: "B", amenities: ["pileta", "jardin"], parking: 1 };
const antes: LeadProfile = { ...base, zones: crit(["Funes"]), preferredAmenities: crit(["jardin"]) };
const despues: LeadProfile = { ...antes, requiredAmenities: crit(["pileta"]) };
assert.equal(must(antes, A).score, must(antes, B).score, "antes empatan");
const a2 = must(despues, A);
const b2 = must(despues, B);
assert.ok(b2.score > a2.score + 30, `B (${b2.score}) pasa claramente a A (${a2.score})`);
assert.equal(a2.hardConflicts.length, 1, "requerido ausente = conflicto duro");
// Sin datos de amenities no se afirma que falte: queda "sin confirmar", no es conflicto.
const sinLista = must(despues, { ...house, id: "C", amenities: [], parking: null });
assert.equal(sinLista.hardConflicts.length, 0);
assert.ok(sinLista.missing.some((m) => m.includes("pileta")));
// Sinónimos: piscina = pileta.
assert.equal(must(despues, { ...house, amenities: ["piscina"] }).hardConflicts.length, 0);

// Venta y alquiler no se mezclan.
assert.equal(scoreCandidate({ ...base, operation: crit("alquiler") }, house), null);

// 18. La explicación coincide con los números: cada grupo con crédito completo tiene su ✓, y cada
// grupo sin crédito tiene su conflicto.
const mixto: LeadProfile = { ...base, zones: crit(["Funes"]), budgetMax: crit(250000), bedroomsMin: crit(4), preferredAmenities: crit(["pileta", "garage"]) };
const exp = must(mixto, house);
assert.ok(exp.matched.some((m) => m.includes("Funes")) && exp.matched.some((m) => m.includes("presupuesto")));
assert.equal(exp.breakdown.groups.location.earned, 1);
assert.equal(exp.breakdown.groups.budget.earned, 1);
assert.ok(exp.breakdown.groups.bedrooms.earned < 1 && exp.conflicting.some((c) => c.includes("dormitorios")));
const puntos = Object.values(exp.breakdown.groups).reduce((s, g) => s + g.points, 0);
const peso = Object.values(exp.breakdown.groups).filter((g) => g.known).reduce((s, g) => s + g.weight, 0);
assert.equal(exp.score, Math.round((puntos / peso) * 100), "el puntaje sale de los grupos que se explican");
for (const g of Object.values(exp.breakdown.groups)) if (!g.known) assert.equal(g.points, 0, "lo desconocido no aporta ni resta");

// 19. La confianza sube a medida que se conocen más criterios.
const c1 = must({ ...base, zones: crit(["Funes"]) }, house).confidence;
const c2 = must({ ...base, zones: crit(["Funes"]), budgetMax: crit(250000) }, house).confidence;
const c3 = must({ ...base, zones: crit(["Funes"]), budgetMax: crit(250000), bedroomsMin: crit(3), propertyTypes: crit(["casa"]) }, house).confidence;
assert.ok(c1 < c2 && c2 < c3, `${c1} < ${c2} < ${c3}`);
// Y baja si lo extraído era dudoso: buen encaje pero poco seguro.
assert.ok(must({ ...base, zones: crit(["Funes"], { confidence: 0.3 }) }, house).confidence < c1);

// 20. La misma propiedad recibe puntajes distintos para contactos distintos.
const leadA: LeadProfile = { ...base, zones: crit(["Funes"]), bedroomsMin: crit(3) };
const leadB: LeadProfile = { ...base, zones: crit(["Rosario"]), bedroomsMin: crit(5) };
assert.notEqual(must(leadA, house).score, must(leadB, house).score);

// ── Perfil, procedencia e incrementalidad ──
// 14. Un mensaje nuevo actualiza el perfil: "Necesito mínimo tres dormitorios."
const ext = parseExtraction(JSON.stringify({ dormitorios: 3, estrictos: ["dormitorios"], confianza: 0.95, amenities_requeridos: ["pileta"], presupuesto_flexible: true, estrictos_raros: 1 }))!;
assert.equal(ext.dormitorios, 3);
assert.deepEqual(ext.estrictos, ["dormitorios"]);
assert.deepEqual(ext.amenities_requeridos, ["pileta"]);
assert.equal(parseExtraction(JSON.stringify({ estrictos: ["inventado"], confianza: 7 }))?.estrictos, undefined, "un criterio desconocido se descarta");
assert.equal(parseExtraction(JSON.stringify({ confianza: 7 }))?.confianza, 1, "la confianza queda entre 0 y 1");

const now = "2026-10-02T12:00:00Z";
const r1 = applyChanges(emptyFlat(), {}, [{ key: "bedroomsMin", value: 3, strict: true }, { key: "zones", value: ["Funes"] }], { source: "ai", messageId: "msg-1", confidence: 0.9, now });
assert.deepEqual(r1.changed.sort(), ["bedroomsMin", "zones"]);
assert.equal(r1.flat.bedroomsMin, 3);
assert.equal(r1.criteria.bedroomsMin?.strict, true);
assert.equal(r1.criteria.bedroomsMin?.messageId, "msg-1", "queda de qué mensaje salió");
assert.equal(r1.criteria.bedroomsMin?.source, "ai");

// 15. Un criterio actualizado recalcula el puntaje: pasar de 3 a 4 dormitorios mínimos baja a la casa.
const flat1 = { ...emptyFlat(), bedroomsMin: 3, zones: ["Funes"] };
const prof1 = profileFromStored(flat1, r1.criteria);
const before = must(prof1, house).score;
const r2 = applyChanges(flat1, r1.criteria, [{ key: "bedroomsMin", value: 4 }], { source: "ai", messageId: "msg-2", confidence: 0.9, now });
const prof2 = profileFromStored({ ...flat1, bedroomsMin: r2.flat.bedroomsMin as number }, r2.criteria);
assert.ok(must(prof2, house).score < before, "al cambiar el criterio cambia el puntaje");
assert.equal(prof2.bedroomsMin?.strict, true, "repetir un dato no borra que era indispensable");

// Incremental: repetir lo mismo no cambia nada; las zonas se acumulan; lo que no vino no se toca.
const rep = applyChanges(flat1, r1.criteria, [{ key: "bedroomsMin", value: 3 }], { source: "ai", messageId: "msg-3", confidence: 0.9, now });
assert.deepEqual(rep.changed, []);
const acum = applyChanges(flat1, r1.criteria, [{ key: "zones", value: ["Roldán"] }], { source: "ai", messageId: "msg-4", confidence: 0.9, now });
assert.deepEqual(acum.flat.zones, ["Funes", "Roldán"]);

// 16. Una corrección humana manda sobre la extracción, y la IA no la vuelve a pisar.
const flat2 = { ...emptyFlat(), priceMax: 220000 };
const stored2: StoredCriteria = { budgetMax: { strict: null, confidence: 0.9, source: "ai", messageId: "m1", updatedAt: now } };
const manual = applyChanges(flat2, stored2, manualChanges({ budgetMax: 250000 }), { source: "manual", messageId: null, confidence: 1, now });
assert.equal(manual.flat.priceMax, 250000);
assert.equal(manual.criteria.budgetMax?.source, "manual");
assert.ok(lockedKeys(manual.criteria).has("budgetMax"));
const trasManual = applyChanges({ ...flat2, priceMax: 250000 }, manual.criteria, [{ key: "budgetMax", value: 220000 }], { source: "ai", messageId: "m9", confidence: 0.9, now });
assert.deepEqual(trasManual.changed, [], "la extracción no pisa lo corregido a mano");
assert.equal(trasManual.flat.priceMax, undefined);
// Y el puntaje usa el valor corregido.
const pM = profileFromStored({ ...emptyFlat(), priceMax: 250000 }, manual.criteria);
assert.equal(pM.budgetMax?.value, 250000);
assert.equal(pM.budgetMax?.source, "manual");
assert.equal(pM.budgetMax?.confidence, 1);
// Vaciar a mano también bloquea.
const vaciar = applyChanges({ ...emptyFlat(), zones: ["Funes"] }, {}, manualChanges({ zones: null }), { source: "manual", messageId: null, confidence: 1, now });
assert.deepEqual(vaciar.flat.zones, []);
// Cambiar solo la exigencia (estricto) no toca el dato.
const soloEstricto = applyChanges(flat2, stored2, manualChanges({}, { budgetMax: true }), { source: "manual", messageId: null, confidence: 1, now });
assert.equal(soloEstricto.flat.priceMax, undefined);
assert.equal(soloEstricto.criteria.budgetMax?.strict, true);

// La entrada manual descarta lo inválido.
const parsed = parseManualInput({ fields: { operation: "regalo", budgetMax: "abc", bedroomsMin: "3", zones: ["Funes", 5], propertyTypes: ["casa", "nave"] }, strict: { zones: true, xx: true } });
assert.equal(parsed.values.operation, undefined);
assert.equal(parsed.values.budgetMax, undefined);
assert.equal(parsed.values.bedroomsMin, 3);
assert.deepEqual(parsed.values.zones, ["Funes"]);
assert.deepEqual(parsed.values.propertyTypes, ["casa"]);
assert.deepEqual(parsed.strict, { zones: true });

// 17. Aislamiento: el inventario de otro cliente nunca se puntúa; la red solo trae lo publicado y ajeno.
const own = (id: string, organizationId: string, status = "disponible"): OwnRow => ({
  id, organizationId, status, operation: "venta", propertyType: "casa", zone: "Funes", city: "Funes", price: "100000", currency: "USD",
  bedrooms: 3, bathrooms: 2, areaM2: "100", parking: 1, amenities: [], features: {},
});
const net = (id: string, ownerOrganizationId: string, status = "publicada"): NetworkRow => ({
  id, ownerOrganizationId, status, operation: "venta", propertyType: "casa", zone: "Funes", city: "Funes", price: "100000", currency: "USD",
  bedrooms: 3, bathrooms: 2, areaM2: "100", features: { pileta: true, notas: "x" },
});
const cands = selectCandidates("ORG-A", [own("a1", "ORG-A"), own("b1", "ORG-B"), own("a2", "ORG-A", "vendida"), own("a3", "ORG-A", "borrador")], [net("n1", "ORG-B"), net("n2", "ORG-A"), net("n3", "ORG-B", "pausada")]);
assert.deepEqual(cands.map((c) => c.id).sort(), ["a1", "n1"], "solo lo propio y ofrecible, más lo publicado por otros");
assert.deepEqual(cands.find((c) => c.id === "n1")?.amenities, ["pileta"], "los amenities de la red salen de las claves en true");

console.log("scoring: OK");
