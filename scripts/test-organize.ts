import assert from "node:assert/strict";
import {
  formatArea,
  organizeAmenities,
  organizeDescription,
  organizeProperty,
  placeLine,
  summaryParts,
  tidyName,
  type PropertyInput,
} from "../src/lib/properties/organize";

const base: PropertyInput = {
  title: "  DEPARTAMENTO   2 AMBIENTES  EN  NUEVA CORDOBA ",
  description: "Luminoso.\r\nAl frente.\r\n\r\n\r\n- Balcón\r\n- Cochera\r\n\r\nContacto por WhatsApp",
  operation: "venta",
  propertyType: "departamento",
  status: "disponible",
  price: 120000,
  currency: "USD",
  zone: "NUEVA CÓRDOBA",
  city: "córdoba",
  addressPublic: "  Bv.  San Juan 100 ",
  bedrooms: 1,
  bathrooms: 1,
  parking: 0,
  areaM2: 45.5,
  areaCoveredM2: null,
  amenities: ["pileta", "Pileta ", "  ", "SUM", "pileta"],
  coverUrl: "https://x.test/c.jpg",
  galleryUrls: ["https://x.test/c.jpg", "https://x.test/1.jpg", "https://x.test/1.jpg"],
  videoUrl: null,
  tour360Url: null,
  mapUrl: null,
  sourceUrl: "https://x.test/aviso",
  source: "google_sheets",
  externalId: "P-1",
  externalUpdatedAt: null,
  syncedAt: null,
};

// Nombres: TODO MAYÚSCULAS o todo minúsculas se pasan a "Nombre Propio"; lo mezclado no se toca.
assert.equal(tidyName("  DEPARTAMENTO   2 AMBIENTES  EN  NUEVA CORDOBA "), "Departamento 2 Ambientes en Nueva Cordoba");
assert.equal(tidyName("cerca del Parque Sarmiento"), "cerca del Parque Sarmiento"); // mezclado: lo escribió una persona
assert.equal(tidyName("cerca del parque"), "Cerca del Parque");
assert.equal(tidyName("Casa en Barrio Jardín"), "Casa en Barrio Jardín");
assert.equal(tidyName("PH"), "PH");
assert.equal(tidyName("   "), null);
assert.equal(placeLine("Centro", "centro"), "Centro");
assert.equal(placeLine(null, "ROSARIO"), "Rosario");

// Descripción: párrafos y viñetas, sin saltos repetidos.
assert.deepEqual(organizeDescription(base.description), [
  { kind: "paragraph", text: "Luminoso. Al frente." },
  { kind: "list", items: ["Balcón", "Cochera"] },
  { kind: "paragraph", text: "Contacto por WhatsApp" },
]);
assert.deepEqual(organizeDescription(null), []);

// Comodidades: sin repetidas ni vacías.
assert.deepEqual(organizeAmenities(base.amenities), ["Pileta", "SUM"]);

// Números y unidades.
assert.equal(formatArea(45.5), "45,5 m²");
assert.equal(formatArea(0), null);
assert.deepEqual(summaryParts(base), ["1 dorm.", "1 baño", "45,5 m²"]); // 0 cocheras no se muestra

// Estructura: SIEMPRE las mismas secciones y filas, aunque falten datos.
const full = organizeProperty(base);
const sparse = organizeProperty({ ...base, price: null, bedrooms: null, zone: null, city: null, coverUrl: null, areaM2: null, addressPublic: null });
assert.deepEqual(full.sections.map((s) => s.id), ["resumen", "caracteristicas", "superficies", "ubicacion"]);
assert.deepEqual(
  full.sections.map((s) => s.facts.map((f) => f.label)),
  sparse.sections.map((s) => s.facts.map((f) => f.label)),
);
assert.equal(full.title, "Departamento 2 Ambientes en Nueva Cordoba");
assert.equal(full.subtitle, "Venta · Departamento · Nueva Córdoba, Córdoba");
assert.equal(full.priceLabel, "USD 120.000");
assert.deepEqual(full.media.gallery, ["https://x.test/1.jpg"]); // sin la portada ni repetidas
assert.deepEqual(full.missing, []); // no falta ningún dato clave
assert.deepEqual(sparse.missing, ["Precio", "Portada", "Zona", "Dormitorios", "Superficie total"]);
assert.equal(sparse.sections[1].facts[0].empty, true);
assert.equal(sparse.sections[1].facts[0].value, "—");
assert.equal(organizeProperty({ ...base, title: null }).title, "Sin título");

console.log("organize: OK");
