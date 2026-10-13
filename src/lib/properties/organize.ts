// Organizador de datos de una propiedad. Función PURA: recibe lo que vino de la base (o de la hoja) y devuelve
// SIEMPRE la misma estructura (mismas secciones, mismas filas, mismo orden), con los textos prolijos.
//
// No inventa ni completa nada: lo que falta queda marcado como vacío (`empty`) y el listado `missing` lo
// nombra. Lo que cambia es solo la presentación: espacios, mayúsculas de títulos y barrios, unidades,
// comodidades repetidas, descripción en párrafos y viñetas.

export type PropertyInput = {
  title: string | null;
  description: string | null;
  operation: string;
  propertyType: string;
  status: string;
  price: number | null;
  currency: string;
  zone: string | null;
  city: string | null;
  addressPublic: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking: number | null;
  areaM2: number | null;
  areaCoveredM2: number | null;
  amenities: string[];
  coverUrl: string | null;
  galleryUrls: string[];
  videoUrl: string | null;
  tour360Url: string | null;
  mapUrl: string | null;
  sourceUrl: string | null;
  source: string;
  externalId: string | null;
  externalUpdatedAt: string | null;
  syncedAt: string | null;
};

export type Fact = { label: string; value: string; empty: boolean };
export type Section = { id: "resumen" | "caracteristicas" | "superficies" | "ubicacion"; title: string; facts: Fact[] };
export type DescriptionBlock = { kind: "paragraph"; text: string } | { kind: "list"; items: string[] };
export type MediaLink = { kind: "video" | "tour" | "mapa" | "aviso"; label: string; url: string };

export type OrganizedProperty = {
  title: string;
  subtitle: string;
  priceLabel: string | null;
  statusLabel: string;
  sections: Section[];
  amenities: string[];
  description: DescriptionBlock[];
  media: { cover: string | null; gallery: string[]; links: MediaLink[] };
  /** Datos que la propiedad no tiene, con el nombre que ve una persona. Sirve para señalar, no para completar. */
  missing: string[];
};

// ─── Textos ──────────────────────────────────────────────────────────────────

const SMALL_WORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "con", "a", "al", "por", "para", "sobre"]);

/** Una sola línea: sin saltos ni espacios repetidos. */
export function oneLine(value: string | null | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  return v.length > 0 ? v : null;
}

const letters = (s: string) => s.replace(/[^\p{L}]/gu, "");

/**
 * Pasa a "Nombre Propio" lo que viene TODO EN MAYÚSCULAS o todo en minúsculas (así se cargan muchas hojas).
 * Si ya tiene mayúsculas y minúsculas mezcladas, se respeta tal cual: lo escribió una persona.
 */
export function tidyName(value: string | null | undefined): string | null {
  const v = oneLine(value);
  if (!v) return null;
  const l = letters(v);
  if (l.length < 3) return v;
  const allUpper = l === l.toUpperCase();
  const allLower = l === l.toLowerCase();
  if (!allUpper && !allLower) return v;
  return v
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.replace(/^(\p{L})/u, (c) => c.toUpperCase())))
    .join(" ");
}

const cap = (s: string) => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** Descripción en bloques: párrafos y listas de viñetas. Normaliza saltos de línea y líneas vacías repetidas. */
export function organizeDescription(value: string | null | undefined): DescriptionBlock[] {
  const raw = (value ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!raw) return [];
  const bullet = /^\s*(?:[-–—•·*▪●]|\d{1,2}[.)])\s+(.*\S)\s*$/u;
  const blocks: DescriptionBlock[] = [];
  let para: string[] = [];
  let list: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ kind: "list", items: list });
    list = [];
  };
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const m = bullet.exec(line);
    if (m) {
      flushPara();
      list.push(m[1].trim());
    } else {
      flushList();
      para.push(t.replace(/\s+/g, " "));
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Comodidades: sin repetidas (sin distinguir mayúsculas), sin vacías, primera letra en mayúscula. */
export function organizeAmenities(values: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const v = oneLine(raw);
    if (!v || v.length > 60) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cap(v));
  }
  return out;
}

// ─── Números ─────────────────────────────────────────────────────────────────

export function formatMoney(price: number | null, currency: string): string | null {
  if (price === null || !Number.isFinite(price)) return null;
  return `${currency} ${price.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
}

export function formatArea(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })} m²`;
}

const count = (n: number | null, one: string, many: string): string | null =>
  n === null || !Number.isFinite(n) ? null : `${n} ${n === 1 ? one : many}`;

/** Resumen corto para la tarjeta del catálogo: siempre en el mismo orden. */
export function summaryParts(p: Pick<PropertyInput, "bedrooms" | "bathrooms" | "parking" | "areaM2">): string[] {
  return [
    count(p.bedrooms, "dorm.", "dorm."),
    count(p.bathrooms, "baño", "baños"),
    p.parking !== null && p.parking > 0 ? count(p.parking, "coch.", "coch.") : null,
    formatArea(p.areaM2),
  ].filter((x): x is string => x !== null);
}

/** "Centro, Rosario" / "Centro" / "Rosario" / null. */
export function placeLine(zone: string | null, city: string | null): string | null {
  const z = tidyName(zone);
  const c = tidyName(city);
  if (z && c) return z.toLowerCase() === c.toLowerCase() ? z : `${z}, ${c}`;
  return z ?? c;
}

// ─── Estructura ──────────────────────────────────────────────────────────────

const EMPTY = "—";
const fact = (label: string, value: string | null): Fact => ({ label, value: value ?? EMPTY, empty: value === null });

export function organizeProperty(p: PropertyInput): OrganizedProperty {
  const title = tidyName(p.title) ?? "Sin título";
  const place = placeLine(p.zone, p.city);

  const sections: Section[] = [
    {
      id: "resumen",
      title: "Resumen",
      facts: [fact("Operación", cap(p.operation)), fact("Tipo", cap(p.propertyType)), fact("Estado", cap(p.status))],
    },
    {
      id: "caracteristicas",
      title: "Características",
      facts: [
        fact("Dormitorios", p.bedrooms === null ? null : String(p.bedrooms)),
        fact("Baños", p.bathrooms === null ? null : String(p.bathrooms)),
        fact("Cocheras", p.parking === null ? null : String(p.parking)),
      ],
    },
    {
      id: "superficies",
      title: "Superficies",
      facts: [fact("Total", formatArea(p.areaM2)), fact("Cubierta", formatArea(p.areaCoveredM2))],
    },
    {
      id: "ubicacion",
      title: "Ubicación",
      facts: [
        fact("Dirección", oneLine(p.addressPublic)),
        fact("Barrio", tidyName(p.zone)),
        fact("Ciudad", tidyName(p.city)),
      ],
    },
  ];

  const links: MediaLink[] = [];
  if (p.videoUrl) links.push({ kind: "video", label: "Video", url: p.videoUrl });
  if (p.tour360Url) links.push({ kind: "tour", label: "Tour 360°", url: p.tour360Url });
  if (p.mapUrl) links.push({ kind: "mapa", label: "Ubicación", url: p.mapUrl });
  if (p.sourceUrl) links.push({ kind: "aviso", label: "Aviso original", url: p.sourceUrl });

  const gallery = [...new Set(p.galleryUrls.filter((u) => u && u !== p.coverUrl))];

  const missing: string[] = [];
  const priceLabel = formatMoney(p.price, p.currency);
  if (!priceLabel) missing.push("Precio");
  if (!p.coverUrl) missing.push("Portada");
  if (!place) missing.push("Zona");
  if (p.bedrooms === null) missing.push("Dormitorios");
  if (p.bathrooms === null) missing.push("Baños");
  if (!formatArea(p.areaM2)) missing.push("Superficie total");

  return {
    title,
    subtitle: [`${cap(p.operation)} · ${cap(p.propertyType)}`, place].filter(Boolean).join(" · "),
    priceLabel,
    statusLabel: cap(p.status),
    sections,
    amenities: organizeAmenities(p.amenities),
    description: organizeDescription(p.description),
    media: { cover: p.coverUrl, gallery, links },
    missing,
  };
}
