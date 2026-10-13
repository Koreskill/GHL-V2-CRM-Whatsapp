import assert from "node:assert/strict";
import { needsReview, currencyInText, inferOperation, mapHeader, num, parseCurrency, parseOperation, parseStatus, parseType, resolvePrice, urlFromFormula } from "../src/lib/sheets/columns";

// La hoja real de la inmobiliaria: estas 30 columnas.
const HEADER = "property_id	operation_type	property_type	listing_title	locality	neighborhood	address	price_sale_amount	price_sale_currency	price_rent_amount	price_rent_currency	price_source_text	surface_total_m2	surface_total_raw	surface_total_kind	land_area_m2	covered_area_m2	semi_covered_area_m2	bedrooms	rooms	bathrooms	toilettes	parking_spaces	description_source	cover_image_preview	cover_image_url	listing_url	data_quality_note	record_status	source_checked_at".split("\t");
assert.equal(HEADER.length, 30);

const m = mapHeader(HEADER);
const col = (h: string) => HEADER.indexOf(h);
assert.deepEqual(m.unrecognized, [], "ninguna columna queda sin entender");
assert.equal(m.recognized.length, 30);
assert.ok(m.recognized.every((r) => r.how === "exacto"));

const expected: Record<string, string> = {
  property_id: "externalId", operation_type: "operation", property_type: "propertyType", listing_title: "title",
  locality: "city", neighborhood: "zone", address: "addressPublic",
  price_sale_amount: "priceSale", price_sale_currency: "priceSaleCurrency", price_rent_amount: "priceRent", price_rent_currency: "priceRentCurrency", price_source_text: "priceSourceText",
  surface_total_m2: "areaM2", surface_total_raw: "areaRaw", surface_total_kind: "areaKind", land_area_m2: "landAreaM2", covered_area_m2: "areaCoveredM2", semi_covered_area_m2: "areaSemiCoveredM2",
  bedrooms: "bedrooms", rooms: "rooms", bathrooms: "bathrooms", toilettes: "toilettes", parking_spaces: "parking",
  description_source: "description", cover_image_preview: "coverPreview", cover_image_url: "coverUrl", listing_url: "sourceUrl",
  data_quality_note: "qualityNote", record_status: "status", source_checked_at: "externalUpdatedAt",
};
for (const [header, field] of Object.entries(expected)) assert.equal(m.index[field as keyof typeof m.index], col(header), `${header} -> ${field}`);

// Lo que ya funcionaba sigue funcionando: encabezados en castellano, con acentos y mayúsculas.
const es = mapHeader(["Property_ID", "Operación", "Tipo de inmueble", "Título", "Precio", "Moneda", "Barrio", "Localidad", "Baños", "Dormitorios", "Superficie total", "URL de portada", "Enlace original"]);
assert.deepEqual(es.unrecognized, []);
assert.equal(es.index.externalId, 0);
assert.equal(es.index.operation, 1);
assert.equal(es.index.bathrooms, 8);

// Aproximado: palabras de más no rompen, pero nunca pisan una exacta.
const aprox = mapHeader(["property_id", "Precio de venta USD", "Precio de alquiler", "random_columna_x"]);
assert.equal(aprox.index.priceSale, 1);
assert.equal(aprox.index.priceRent, 2);
assert.deepEqual(aprox.unrecognized, ["random_columna_x"], "lo desconocido se reporta, no se adivina");
const noPisa = mapHeader(["precio", "price_sale_amount", "precio venta"]);
assert.equal(noPisa.index.priceSale, 1, "la exacta gana");
assert.equal(noPisa.index.price, 0);
assert.equal(mapHeader(["property_id", "property_id"]).index.externalId, 0, "un campo, una sola columna");

// Operación, tipo y estado, en español y en inglés.
assert.equal(parseOperation("Sale"), "venta");
assert.equal(parseOperation("VENTA"), "venta");
assert.equal(parseOperation("Rent"), "alquiler");
assert.equal(parseOperation("Alquiler Temporal"), "temporario");
assert.equal(parseOperation("permuta"), undefined, "lo desconocido no se adivina");
assert.equal(parseType("Apartment"), "departamento");
assert.equal(parseType("Dpto"), "departamento");
assert.equal(parseType("House"), "casa");
assert.equal(parseType("Lote"), "terreno");
assert.equal(parseType("Local comercial"), "local");
assert.equal(parseType("nave espacial"), undefined);
assert.equal(parseStatus("active"), "disponible");
assert.equal(parseStatus("Sold"), "vendida");
assert.equal(parseStatus("inactive"), "pausada");
assert.equal(parseStatus("extraido"), "disponible", "estado de carga de la hoja real");
assert.equal(parseStatus("revisar"), "disponible");
assert.equal(needsReview("revisar"), true);
assert.equal(needsReview("extraido"), false);
assert.equal(parseStatus("quien sabe"), undefined);
assert.equal(parseType("galpón"), "otro");
assert.equal(parseOperation("venta|alquiler"), undefined, "ambas a la vez: no se adivina");

// Números: el punto de miles argentino no es un decimal.
assert.equal(num("120.000"), "120000", "120.000 son ciento veinte mil");
assert.equal(num("USD 120.000"), "120000");
assert.equal(num("1.250.000"), "1250000");
assert.equal(num("1.250,50"), "1250.5");
assert.equal(num("120,000"), "120000");
assert.equal(num("85,5"), "85.5");
assert.equal(num("85.5"), "85.5");
assert.equal(num("120"), "120");
assert.equal(num("Consultar"), null);
assert.equal(num(""), null);

// Monedas.
assert.equal(parseCurrency("U$S"), "USD");
assert.equal(parseCurrency("usd"), "USD");
assert.equal(parseCurrency("$"), "ARS");
assert.equal(parseCurrency("Pesos"), "ARS");
assert.equal(parseCurrency("eur"), "EUR");
assert.equal(parseCurrency("pesito"), null);
assert.equal(currencyInText("USD 120.000"), "USD");
assert.equal(currencyInText("U$S 95.000"), "USD");
assert.equal(currencyInText("$ 450.000"), "ARS");

// Precio según la operación de ESA fila.
const venta = resolvePrice("venta", { priceSale: "120.000", priceSaleCurrency: "USD", priceRent: "", priceRentCurrency: "" });
assert.deepEqual([venta.price, venta.currency], ["120000", "USD"]);
const alquiler = resolvePrice("alquiler", { priceSale: "", priceRent: "450.000", priceRentCurrency: "ARS" });
assert.deepEqual([alquiler.price, alquiler.currency], ["450000", "ARS"]);
// Una venta NO toma el precio de alquiler (ni al revés).
assert.equal(resolvePrice("venta", { priceRent: "450.000", priceRentCurrency: "ARS" }).price, null);
assert.equal(resolvePrice("alquiler", { priceSale: "120.000", priceSaleCurrency: "USD" }).price, null);
// Sin monto, el texto original sirve como último recurso y avisa.
const deTexto = resolvePrice("venta", { priceSale: "", priceSourceText: "USD 95.000" });
assert.deepEqual([deTexto.price, deTexto.currency], ["95000", "USD"]);
assert.ok(deTexto.note?.includes("texto original"));
// Con columna genérica "precio" también funciona.
assert.deepEqual([resolvePrice("venta", { price: "80.000", currency: "u$s" }).price, resolvePrice("venta", { price: "80.000", currency: "u$s" }).currency], ["80000", "USD"]);
// Monto 0 o texto: sin precio, sin inventar.
assert.equal(resolvePrice("venta", { priceSale: "0" }).price, null);
assert.equal(resolvePrice("venta", { priceSale: "Consultar" }).price, null);

// Operación deducida solo si hay UN precio posible.
assert.equal(inferOperation({ priceSale: "120.000" }), "venta");
assert.equal(inferOperation({ priceRent: "450.000" }), "alquiler");
assert.equal(inferOperation({ priceSale: "120.000", priceRent: "450.000" }), null, "ambos: no se adivina");
assert.equal(inferOperation({}), null);

// Vista previa de portada: una fórmula =IMAGE("...") trae el enlace adentro.
assert.equal(urlFromFormula('=IMAGE("https://cdn.ejemplo.com/a.jpg")'), "https://cdn.ejemplo.com/a.jpg");
assert.equal(urlFromFormula("sin enlace"), null);
assert.equal(urlFromFormula('=IMAGE("javascript:alert(1)")'), null);

console.log("sheet-columns: OK");

// ── Análisis de la hoja (lo que ve quien la carga) ──
import { analyzeRows } from "../src/lib/sheets/analyze";
const row = (o: Record<string, string>) => HEADER.map((h) => o[h] ?? "");
const hoja = [
  HEADER,
  row({ property_id: "1", operation_type: "venta", property_type: "casa", listing_title: "A", neighborhood: "Centro", price_sale_amount: "100000", price_sale_currency: "USD", cover_image_url: "https://x.com/a.jpg", record_status: "extraido" }),
  row({ property_id: "2", operation_type: "alquiler", property_type: "galpón", listing_title: "B", locality: "Funes", price_rent_amount: "450000", price_rent_currency: "ARS", record_status: "revisar" }),
  row({ property_id: "3", operation_type: "venta|alquiler", property_type: "casa", price_sale_amount: "5", price_rent_amount: "5" }),
  row({ property_id: "4", operation_type: "permuta", property_type: "casa" }),
  row({ property_id: "1", operation_type: "venta" }),
  row({ operation_type: "venta" }),
  row({ property_id: "5", operation_type: "venta", property_type: "nave espacial", record_status: "quien sabe" }),
  HEADER.map(() => ""),
];
const an = analyzeRows(hoja);
assert.equal(an.rows, 8);
assert.equal(an.mapped.length, 30);
assert.deepEqual(an.unused, []);
assert.equal(an.counts.importable, 3, "filas 1, 2 y 5");
assert.equal(an.counts.ambasOperaciones, 1);
assert.equal(an.counts.operacionNoReconocida, 1);
assert.equal(an.counts.identificadorRepetido, 1);
assert.equal(an.counts.sinIdentificador, 1);
assert.equal(an.counts.sinPrecio, 1, "la fila 5 no tiene precio");
assert.equal(an.counts.sinPortada, 2);
assert.deepEqual(an.unknownValues.map((u) => `${u.column}:${u.value}`).sort(), ["estado:quien sabe", "operación:permuta", "operación:venta|alquiler", "tipo:nave espacial"]);
assert.deepEqual(an.missing, [], "con las 30 columnas no falta ninguna recomendada");

// Una hoja a la que le faltan columnas: se le dice cuáles.
const corta = analyzeRows([["id", "titulo", "extra raro"], ["1", "A", "x"]]);
assert.ok(corta.missing.some((m) => m.field === "operation" && m.level === "obligatoria"));
assert.ok(corta.missing.some((m) => m.field === "price"), "sin ninguna columna de precio, se pide una");
assert.ok(!corta.missing.some((m) => m.field === "priceRent"), "pide un precio genérico, no cada uno por separado");
assert.deepEqual(corta.unused, ["extra raro"]);
// Con solo precio de venta no se pide el de alquiler.
assert.ok(!analyzeRows([["property_id", "operation_type", "price_sale_amount"], ["1", "venta", "5"]]).missing.some((m) => m.field === "priceRent"));
console.log("analisis: OK");
