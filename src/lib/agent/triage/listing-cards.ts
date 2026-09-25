import type { Channel } from "@/db/schema";
import type { CatalogProperty } from "./catalog-search";

/**
 * Fichas de propiedades armadas por el CÓDIGO, no por el modelo.
 *
 * Esta es la garantía de fondo contra las propiedades inventadas: el modelo elige CUÁLES mostrar
 * (por una clave que solo existe si la propiedad salió de la búsqueda) y el texto de la ficha
 * se arma acá con los datos de la base. El modelo no puede poner un precio, unos metros o un
 * barrio en una ficha, porque no escribe las fichas.
 *
 * Solo se muestra lo que está cargado. Un dato vacío no se completa ni se estima: se omite, o se
 * dice "a consultar" cuando es el precio, que es lo primero que el cliente busca.
 */

const OPERATION_LABEL: Record<string, string> = {
  venta: "Venta",
  alquiler: "Alquiler",
  temporario: "Alquiler temporario",
};

const TYPE_LABEL: Record<string, string> = {
  departamento: "Departamento",
  casa: "Casa",
  ph: "PH",
  terreno: "Terreno",
  local: "Local",
  oficina: "Oficina",
  cochera: "Cochera",
  otro: "Propiedad",
};

export function formatPrice(price: number | null, currency: string): string {
  if (price === null) return "Precio a consultar";
  const amount = price.toLocaleString("es-AR", { maximumFractionDigits: 0 });
  return currency === "ARS" ? `$ ${amount}` : `${currency} ${amount}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// Negrita de WhatsApp (*texto*). Instagram y Messenger no la interpretan y mostrarían los
// asteriscos, así que ahí va el texto plano.
const bold = (text: string, channel: Channel) => (channel === "whatsapp" ? `*${text}*` : text);

export function renderCard(p: CatalogProperty, channel: Channel): string {
  const lines: string[] = [];

  lines.push(bold(p.title?.trim() || `${TYPE_LABEL[p.propertyType] ?? "Propiedad"} en ${p.zone ?? "zona a consultar"}`, channel));

  const where = [p.zone, p.city].filter(Boolean).join(", ");
  lines.push(
    [OPERATION_LABEL[p.operation] ?? p.operation, TYPE_LABEL[p.propertyType] ?? p.propertyType, where]
      .filter(Boolean)
      .join(" · "),
  );

  // Precio y características en una línea: es lo que se compara de un vistazo.
  const facts = [formatPrice(p.price, p.currency)];
  if (p.bedrooms !== null && p.bedrooms > 0) facts.push(plural(p.bedrooms, "dormitorio", "dormitorios"));
  if (p.bathrooms !== null && p.bathrooms > 0) facts.push(plural(p.bathrooms, "baño", "baños"));
  if (p.parking !== null && p.parking > 0) facts.push(plural(p.parking, "cochera", "cocheras"));
  if (p.areaM2 !== null && p.areaM2 > 0) facts.push(`${p.areaM2} m²`);
  lines.push(facts.join(" · "));

  // Reservada: se ofrece, pero diciéndolo. Ocultarlo sería venderle algo que quizás no esté.
  if (p.status === "reservada") lines.push("⚠️ Reservada: consultá si sigue disponible");

  // Un enlace por medio que exista. La ficha completa primero; si no hay, lo que haya. Así lo que
  // el modelo dice que hay ("tiene_video") es exactamente lo que el cliente encuentra abajo.
  if (p.sourceUrl) lines.push(`Ver ficha: ${p.sourceUrl}`);
  else if (p.coverUrl || p.galleryUrls.length) lines.push(`Fotos: ${p.coverUrl ?? p.galleryUrls[0]}`);
  if (p.videoUrl) lines.push(`Video: ${p.videoUrl}`);
  if (p.tour360Url) lines.push(`Tour 360°: ${p.tour360Url}`);

  return lines.join("\n");
}

/** Las fichas elegidas, separadas por una línea en blanco. Máximo 3: más es spam. */
export function renderCards(selected: CatalogProperty[], channel: Channel): string {
  return selected
    .slice(0, 3)
    .map((p) => renderCard(p, channel))
    .join("\n\n");
}

/**
 * Qué se puede afirmar sobre una propiedad en el texto libre.
 * El validador lo usa para saber si un número que escribió el modelo es real.
 */
export function factsOf(p: CatalogProperty) {
  return {
    price: p.price,
    currency: p.currency,
    bedrooms: p.bedrooms,
    bathrooms: p.bathrooms,
    parking: p.parking,
    areaM2: p.areaM2,
    areaCoveredM2: p.areaCoveredM2,
  };
}
