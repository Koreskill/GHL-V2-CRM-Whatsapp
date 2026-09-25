import assert from "node:assert/strict";
import {
  detectOperation,
  detectTypes,
  extractAmounts,
  findReferencedProperties,
  inferCurrency,
  searchCatalog,
  type CatalogProperty,
} from "../src/lib/agent/triage/catalog-search";
import { checkReply, type GuardInput } from "../src/lib/agent/triage/guard";
import { renderCard } from "../src/lib/agent/triage/listing-cards";
import { buildCriteria, detectZones, retrieve } from "../src/lib/agent/triage/retrieval";
import { mediaFromDescription } from "../src/lib/properties/media";
import { __PROMISES_TEAM_FOR_TESTS as PROMISES_TEAM } from "../src/lib/agent/triage/compose";
import { normalize } from "../src/lib/agent/triage/catalog-search";

// Pruebas del motor conversacional SIN base y SIN modelos: búsqueda, fichas, validador y
// extracción de enlaces. Los casos de "lo que no puede pasar" son mensajes REALES que mandó el bot.

// ─── Catálogo de prueba (forma real, datos inventados para el test) ─────────
const prop = (p: Partial<CatalogProperty> & { id: string }): CatalogProperty => ({
  externalId: null,
  title: null,
  operation: "venta",
  propertyType: "departamento",
  status: "disponible",
  price: null,
  currency: "USD",
  zone: null,
  city: "Rosario",
  addressPublic: null,
  bedrooms: null,
  bathrooms: null,
  parking: null,
  areaM2: null,
  areaCoveredM2: null,
  amenities: [],
  description: null,
  coverUrl: null,
  galleryUrls: [],
  videoUrl: null,
  tour360Url: null,
  sourceUrl: null,
  mapUrl: null,
  features: {},
  ...p,
});

const CATALOG: CatalogProperty[] = [
  prop({ id: "pichincha", title: "Departamento 1 Dormitorio con Cochera en Venta", zone: "Pichincha", price: 88000, bedrooms: 1, parking: 1 }),
  prop({ id: "oro", title: "Pasillo 3 dormitorios con patio y terraza a 1 cuadra de Oroño", propertyType: "ph", zone: "Centro", price: 88000, bedrooms: 3, sourceUrl: "https://ejemplo-inmo.com.ar/p/1" }),
  prop({ id: "c1", title: "Departamento 1 Dormitorio", zone: "Centro", price: 54000, bedrooms: 1 }),
  prop({ id: "c2", title: "Departamento 2 Dormitorios", zone: "Centro", price: 78000, bedrooms: 2 }),
  prop({ id: "c3", title: "Depto piso exclusivo con cochera", zone: "Centro", price: 210000, bedrooms: 3 }),
  prop({ id: "casa-fish", title: "Casa 3 dormitorios zona Fisherton", propertyType: "casa", zone: "Fisherton", price: 185000 }),
  prop({ id: "alq", title: "Monoambiente", operation: "alquiler", zone: "Centro", price: 400000, currency: "ARS" }),
  prop({ id: "coch", title: "Cochera en el Centro", propertyType: "cochera", zone: "Centro", price: 17000 }),
];

// ─── Montos ─────────────────────────────────────────────────────────────────
{
  const casos: [string, number[]][] = [
    ["88 mil", [88000]],
    ["88k", [88000]],
    ["1,5 millones", [1500000]], // "mil" no puede comerse el comienzo de "millones"
    ["1 millón", [1000000]], // con tilde
    ["3 palos", [3000000]],
    ["150 lucas", [150000]],
    ["USD 88.000", [88000]],
    ["60000", [60000]],
    ["$ 470.000", [470000]],
    ["65 m²", []], // "m" es METROS, no millón: antes daba 65 millones
    ["tiene 65m2", []],
    ["2 ambientes", []],
    ["Fotos: https://cdn.ejemplo.com/pictures/11449035238531559.jpg", []], // dígitos de una URL no son un monto
  ];
  for (const [texto, esperado] of casos) assert.deepEqual(extractAmounts(texto), esperado, `montos de «${texto}»`);
}

// ─── Tipos y operación ──────────────────────────────────────────────────────
{
  assert.equal(detectOperation("busco alquilar"), "alquiler");
  assert.equal(detectOperation("quiero comprar"), "venta");
  assert.equal(detectOperation("renta"), "alquiler", "renta se entiende aunque el bot no la use");
  assert.deepEqual(detectTypes("un depto"), ["departamento"]);
  // "con cochera" es un amenity: pegar el título "Departamento con Cochera" no puede buscar cocheras.
  assert.deepEqual(detectTypes("Departamento 1 Dormitorio con Cochera en Venta"), ["departamento"]);
}

// ─── Referencia a una propiedad puntual ─────────────────────────────────────
{
  const ref = (t: string) => findReferencedProperties(t, CATALOG).map((r) => r.property.id);

  // EL CASO REPORTADO: pegó el texto de la tarjeta y el bot contestó "no tengo".
  assert.deepEqual(ref("Hola me intereso la propiedad venta · departamento · Pichincha, Rosario"), ["pichincha"]);
  assert.deepEqual(ref("me interesa el depto de 88 mil"), ["pichincha"], "por precio + tipo");
  assert.deepEqual(ref("Departamento 1 Dormitorio con Cochera en Venta"), ["pichincha"], "por título pegado");
  assert.deepEqual(ref("el pasillo de 3 dormitorios cerca de Oroño"), ["oro"]);
  assert.deepEqual(ref("https://ejemplo-inmo.com.ar/p/1"), ["oro"], "por enlace");

  // "algo en Centro" coincide con muchas: no es una referencia, es una búsqueda.
  assert.deepEqual(ref("algo en Centro"), []);
  // Pide alquiler: la venta de Pichincha no es a la que se refiere.
  assert.ok(!ref("alquiler en Pichincha").includes("pichincha"));
}

// ─── Búsqueda por criterios ─────────────────────────────────────────────────
{
  const base = { operation: null, propertyTypes: [], zones: [], priceMin: null, priceMax: null, currency: null, bedroomsMin: null };

  const centro = searchCatalog({ ...base, operation: "venta", propertyTypes: ["departamento"], zones: ["Centro"], priceMax: 80000 }, CATALOG);
  assert.deepEqual(centro.hits.map((h) => h.property.id).sort(), ["c1", "c2"], "solo los que entran en el presupuesto");
  assert.ok(centro.hits.every((h) => !h.alternativa));

  // Si hay coincidencias exactas NO se mezclan alternativas de otra zona.
  const pich = searchCatalog({ ...base, propertyTypes: ["departamento"], zones: ["Pichincha"] }, CATALOG);
  assert.deepEqual(pich.hits.map((h) => h.property.id), ["pichincha"]);

  // Moneda: un presupuesto de alquiler en pesos NO se compara contra dólares.
  assert.equal(inferCurrency(CATALOG, "alquiler"), "ARS");
  assert.equal(inferCurrency(CATALOG, "venta"), "USD");
  const alq = searchCatalog({ ...base, operation: "alquiler", priceMax: 500000 }, CATALOG);
  assert.deepEqual(alq.hits.map((h) => h.property.id), ["alq"], "500 mil se lee en pesos para un alquiler");
  assert.equal(alq.currencyUsed, "ARS");

  // Alquiler en Fisherton: no hay, pero hay un alquiler en Centro → se ofrece COMO alternativa.
  // Nunca una venta: comprar y alquilar no se mezclan.
  const fish = searchCatalog({ ...base, operation: "alquiler", zones: ["Fisherton"] }, CATALOG);
  assert.equal(fish.totalExact, 0);
  assert.deepEqual(fish.hits.map((h) => [h.property.id, h.alternativa]), [["alq", true]]);
  assert.ok(fish.hits.every((h) => h.property.operation === "alquiler"), "una venta nunca es alternativa de un alquiler");

  // Sin ningún alquiler en el catálogo (la cartera real): cero alternativas. Es lo que le impide
  // al agente ofrecer "opciones en zonas cercanas" que no existen.
  const soloVentas = CATALOG.filter((p) => p.operation === "venta");
  const nada = searchCatalog({ ...base, operation: "alquiler", zones: ["Fisherton"] }, soloVentas);
  assert.equal(nada.hits.length, 0);
  assert.equal(nada.totalAlternatives, 0);

  // Muchas coincidencias: se informa el total para que el agente pregunte en vez de elegir a ciegas.
  const muchas = searchCatalog({ ...base, zones: ["Centro"] }, CATALOG);
  assert.ok(muchas.totalExact > 3);
  assert.equal(muchas.hits.length, 3);
}

// ─── Retrieval: memoria del perfil y conversación ───────────────────────────
{
  assert.deepEqual(detectZones("depto por pichincha", CATALOG), ["Pichincha"]);

  // Lo dicho antes se conserva: "Si" no trae datos, pero el perfil sí.
  const criteria = buildCriteria({
    text: "Si",
    catalog: CATALOG,
    profile: { operation: "venta", propertyTypes: ["departamento"], zones: ["Pichincha"], priceMin: null, priceMax: null, currency: null, bedroomsMin: null },
    thisTurn: { operation: null, propertyType: null },
  });
  assert.deepEqual(criteria.zones, ["Pichincha"], "un 'Si' no borra la zona que ya dijo");

  // "¿Tenés fotos?" sin datos nuevos: se habla de lo que ya se mostró.
  const conv = retrieve({ text: "¿tenés fotos?", catalog: CATALOG, criteria, shownIds: ["pichincha"] });
  assert.equal(conv.mode, "conversacion");
  assert.deepEqual(conv.offered.map((o) => o.property.id), ["pichincha"]);

  // Se le mostró una VENTA y después dijo que quiere ALQUILAR: esa venta ya no es "lo que se venía hablando".
  const giro = retrieve({ text: "dale enviamela", catalog: CATALOG, criteria: { ...criteria, operation: "alquiler" }, shownIds: ["pichincha"] });
  assert.ok(!giro.offered.some((o) => o.property.id === "pichincha"), "no se re-ofrece una venta a quien quiere alquilar");

  // Las claves que ve el modelo son P1, P2…, no ids de la base.
  assert.ok(conv.offered.every((o) => /^P\d$/.test(o.ref)));
}

// ─── Fichas armadas por código ──────────────────────────────────────────────
{
  const card = renderCard(CATALOG[0], "whatsapp");
  assert.match(card, /\*Departamento 1 Dormitorio con Cochera en Venta\*/, "negrita de WhatsApp");
  assert.match(card, /USD 88\.000/);
  assert.match(card, /1 dormitorio · .*1 cochera/);
  assert.doesNotMatch(card, /Ver ficha|Video/, "sin enlaces cargados, la ficha no promete ninguno");

  // En Instagram/Messenger los asteriscos se verían literales.
  assert.doesNotMatch(renderCard(CATALOG[0], "instagram"), /\*/);

  // Precio vacío: se dice, no se estima.
  assert.match(renderCard(prop({ id: "x", title: "Sin precio" }), "whatsapp"), /Precio a consultar/);
  assert.match(renderCard(prop({ id: "y", title: "Reservada", status: "reservada", price: 1 }), "whatsapp"), /Reservada/);
  assert.match(renderCard(prop({ id: "z", title: "Alq", price: 400000, currency: "ARS" }), "whatsapp"), /\$ 400\.000/);
}

// ─── Validador: los mensajes MALOS reales que mandó el bot ─────────────────
{
  const g = (text: string, extra: Partial<GuardInput> = {}) =>
    checkReply({
      text,
      allowedAmounts: [],
      allowedAreas: [],
      offeredCount: 0,
      alternativesCount: 0,
      media: { fotos: false, video: false, tour: false },
      ...extra,
    }).map((v) => v.code);

  // Inventó dos departamentos en Pichincha con precio y metros (no había ninguno en alquiler).
  const invento = g(
    "Te paso algunas opciones de departamentos en alquiler cerca de $60.000 en Pichincha: \n\n📍 Pichincha Centro\n🏠 Depto — 2 amb. — 50 m²\n💰 $58.000\n\n📍 Pichincha Norte\n🏠 Depto — 3 amb. — 65 m²\n💰 $62.000",
    { allowedAmounts: [60000] },
  );
  assert.ok(invento.includes("monto_inventado"), "58.000 y 62.000 no existen");
  assert.ok(invento.includes("superficie_inventada"), "50 y 65 m² no existen");
  assert.ok(invento.includes("aviso_inventado"), "formato de aviso sin ninguna propiedad real");

  // El mismo invento sin emojis: tiene que atraparse por los metros, no por los dibujitos.
  assert.ok(
    g("Tengo un depto de 2 ambientes, 50 m² en Pichincha Centro.").includes("aviso_inventado"),
    "un aviso sin emojis también es un aviso",
  );

  // Insistió con el departamento inventado.
  assert.ok(g("El departamento en Pichincha Norte tiene 3 ambientes, 65 m². El alquiler es $62.000.", { allowedAmounts: [60000] }).includes("monto_inventado"));

  // Dijo "no tengo" cuando la búsqueda había encontrado.
  assert.ok(g("Por ahora no tengo departamentos en venta en Pichincha, Rosario.", { offeredCount: 1 }).includes("falso_sin_stock"));

  // "En la ficha vas a encontrar fotos y video" de una propiedad sin ninguno cargado.
  const medios = g("Te paso la info. En la ficha vas a encontrar fotos y video para que lo veas bien.", { offeredCount: 1 });
  assert.ok(medios.includes("medio_inexistente"));

  // Ofreció "opciones en zonas cercanas" sin un solo alquiler disponible en todo el catálogo.
  assert.ok(g("No tengo alquileres en Pichincha. ¿Te muestro opciones en zonas cercanas?").includes("alternativas_inexistentes"));

  // Dialecto de otro país.
  assert.ok(g("¿Qué zona o colonia en Pichincha te interesa?").includes("dialecto"));
  assert.ok(g("¿Qué operación buscás, compra o renta?").includes("dialecto"));
  assert.ok(g("¿Qué buscas exactamente?").includes("dialecto"), "tuteo sin tilde");

  // Compromisos que el sistema no verificó.
  assert.ok(g("Listo, te confirmo la visita para el sábado.").includes("compromiso"));

  // Un plazo que la inmobiliaria nunca definió (salió de verdad en un acuse de reclamo).
  assert.ok(g("Una persona del equipo lo va a revisar y te va a responder dentro de las próximas 24 horas.").includes("plazo_inventado"));
  assert.ok(g("Hoy mismo te escribe un asesor.").includes("plazo_inventado"));

  // Ofrecer mandar la ficha que YA va en el mismo mensaje (frases reales).
  assert.ok(g("Te paso este departamento. Si querés, te mando la ficha con todos los detalles.", { offeredCount: 1, attaching: true }).includes("ofrece_lo_enviado"));
  assert.ok(g("Tengo uno en Pichincha. ¿Querés que te lo muestre?", { offeredCount: 1, attaching: true }).includes("ofrece_lo_enviado"));
  assert.ok(g("Te paso tres. ¿Querés que te mande las fichas para que los veas?", { offeredCount: 3, attaching: true }).includes("ofrece_lo_enviado"));
  // Sin ficha adjunta, ofrecer mostrarla está bien.
  assert.ok(!g("Tengo uno en Pichincha. ¿Querés que te lo muestre?", { offeredCount: 1, attaching: false }).includes("ofrece_lo_enviado"));

  // Repetir casi textual el mensaje anterior (pasó ante un "sí" ambiguo).
  assert.ok(
    g("El departamento que tengo en Pichincha está por encima de tu presupuesto. ¿Querés que te avise si entra algo más económico o que te muestre opciones en otras zonas?", {
      offeredCount: 1,
      alternativesCount: 3,
      lastBotMessage:
        "El departamento que tengo en Pichincha está un poco por encima de ese presupuesto. ¿Querés que te muestre algunas opciones en otras zonas o que te avise si entra algo más económico en Pichincha?",
    }).includes("repite"),
  );
}

// ─── Validador: lo HONESTO tiene que pasar (sin falsos positivos) ──────────
{
  const limpio = (text: string, extra: Partial<GuardInput> = {}) =>
    assert.deepEqual(
      checkReply({
        text,
        allowedAmounts: [],
        allowedAreas: [],
        offeredCount: 1,
        alternativesCount: 0,
        media: { fotos: false, video: false, tour: false },
        ...extra,
      }),
      [],
      `no tenía que bloquear: «${text}»`,
    );

  limpio("Te paso lo que tengo que coincide con lo que buscás.", {}); // voseo con tilde (antes daba falso tuteo)
  limpio("¿Necesitás algo más? ¿Sabés qué zona preferís?");
  limpio("Sí, el de Pichincha está a USD 88.000.", { allowedAmounts: [88000] });
  limpio("¿Cuál es tu presupuesto?");
  limpio("No tengo ese dato cargado, lo consulto con el equipo.");
  limpio("Ese departamento no tiene fotos cargadas, pero lo consulto con el equipo.");
  limpio("No tengo exactamente eso, pero tengo opciones en zonas cercanas.", { offeredCount: 0, alternativesCount: 3 });
  limpio("En la ficha tenés las fotos y el video.", { media: { fotos: true, video: true, tour: false } });
  limpio("Repetís $60.000 y te busco con ese presupuesto.", { allowedAmounts: [60000] });
  limpio("Un asesor te va a contactar a la brevedad.");
  limpio("Anoté tu interés para mañana a las 10. Un asesor te lo confirma."); // el horario lo propuso el cliente
  limpio("Acá tenés la ficha con todos los detalles.", { attaching: true });
}

// ─── Promesas del bot que dependen de una persona ───────────────────────────
// Si el bot dice "lo consulto con el equipo", el equipo TIENE que enterarse. Estas frases son
// reales: el bot las dijo y, sin esto, nadie recibía el aviso.
{
  const promete = (t: string) => PROMISES_TEAM.test(normalize(t));
  assert.ok(promete("Las expensas no las tengo cargadas, pero lo consulto con el equipo y te aviso."));
  assert.ok(promete("Por ahora no tengo ni un aproximado, pero ya consulté con el equipo."));
  assert.ok(promete("No puedo confirmarte un descuento, pero paso tu oferta al asesor para que la evalúe."));
  assert.ok(promete("Un asesor te va a contactar para coordinar."));
  assert.ok(!promete("Te paso tres departamentos en el Centro que están dentro de tu presupuesto."));
  assert.ok(!promete("Te paso la ficha para que veas más detalles."));
  assert.ok(!promete("¿Qué estás buscando? Contame zona y presupuesto."));
}

// ─── Enlaces escritos en la descripción ─────────────────────────────────────
{
  const m = mediaFromDescription(
    "Lindo depto. Le adjunto el link con fotos: https://www.inmo.com.ar/p/123-Depto-en-Venta.\n\nVideo: https://youtu.be/abc123",
  );
  assert.equal(m.ficha, "https://www.inmo.com.ar/p/123-Depto-en-Venta", "sin el punto final pegado");
  assert.equal(m.video, "https://youtu.be/abc123");

  // Los paréntesis que SON parte del enlace no se cortan.
  assert.equal(
    mediaFromDescription("Ficha: https://www.inmo.com.ar/p/3708-Casa-(P.-Esther)-Country").ficha,
    "https://www.inmo.com.ar/p/3708-Casa-(P.-Esther)-Country",
  );
  // Pero un ")" que cierra el texto, sí.
  assert.equal(mediaFromDescription("(ver https://www.inmo.com.ar/p/9)").ficha, "https://www.inmo.com.ar/p/9");

  // Enlace de relleno de una plantilla: le daría un 404 al cliente.
  assert.equal(mediaFromDescription("Publicación: https://www.inmo.com.ar/p/xxxxxxx").ficha, null);

  // http se sube a https (WhatsApp marca http como "no seguro").
  assert.equal(mediaFromDescription("http://www.inmo.com.ar/p/7").ficha, "https://www.inmo.com.ar/p/7");

  assert.deepEqual(mediaFromDescription("Foto: https://cdn.inmo.com/a.jpg").fotos, ["https://cdn.inmo.com/a.jpg"]);
  assert.deepEqual(mediaFromDescription(null), { ficha: null, video: null, tour: null, fotos: [] });
}

console.log("conversational: OK");
