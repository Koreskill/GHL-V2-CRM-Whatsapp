// Scoring determinista del cruce prospecto <-> propiedad de red. Puro y testeable:
// no toca la base ni la IA. Devuelve score 0–1 y las razones que lo explican.

export type MatchRequirement = {
  operation: string | null;
  propertyTypes: string[];
  zones: string[];
  bedroomsMin: number | null;
  bathroomsMin: number | null;
  priceMin: number | null;
  priceMax: number | null;
  areaMin: number | null;
  mustHave: string[];
  niceToHave: string[];
};

export type MatchCandidate = {
  operation: string;
  propertyType: string;
  price: number | null;
  zone: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  features: Record<string, unknown>;
};

export type MatchReason = { factor: string; peso: number; detalle: string };
export type MatchScore = { score: number; reasons: MatchReason[]; excluded: boolean };

const norm = (s: string) => s.trim().toLowerCase();

function hasFeature(features: Record<string, unknown>, key: string): boolean {
  const target = norm(key);
  for (const [k, v] of Object.entries(features)) {
    if (norm(k) === target) return v === true || v === "true" || (typeof v === "string" && norm(v) === "si");
    if (Array.isArray(v) && v.some((x) => typeof x === "string" && norm(x) === target)) return true;
  }
  return false;
}

// Pesos de los factores blandos (suman 1). Los factores "excluyentes" (operación, tipo,
// precio fuera de rango, must-have faltante) marcan la coincidencia como excluida.
const W = { price: 0.35, zone: 0.25, type: 0.2, bedrooms: 0.1, bathrooms: 0.05, area: 0.05 } as const;

export function scoreMatch(req: MatchRequirement, c: MatchCandidate): MatchScore {
  const reasons: MatchReason[] = [];
  let excluded = false;
  let score = 0;

  // Operación: excluyente. Vender vs alquilar no se mezcla.
  if (req.operation && norm(req.operation) !== norm(c.operation)) {
    return {
      score: 0,
      reasons: [{ factor: "operacion", peso: 0, detalle: `Busca ${req.operation}, la propiedad es ${c.operation}` }],
      excluded: true,
    };
  }

  // Tipo de propiedad.
  if (req.propertyTypes.length) {
    const ok = req.propertyTypes.some((t) => norm(t) === norm(c.propertyType));
    if (ok) {
      score += W.type;
      reasons.push({ factor: "tipo", peso: W.type, detalle: `Coincide el tipo (${c.propertyType})` });
    } else {
      excluded = true;
      reasons.push({ factor: "tipo", peso: 0, detalle: `Tipo ${c.propertyType} fuera de lo buscado` });
    }
  } else {
    score += W.type;
  }

  // Precio: dentro del rango suma completo; fuera, excluyente.
  if (c.price != null && (req.priceMin != null || req.priceMax != null)) {
    const overMax = req.priceMax != null && c.price > req.priceMax;
    const underMin = req.priceMin != null && c.price < req.priceMin;
    if (overMax || underMin) {
      excluded = true;
      reasons.push({ factor: "precio", peso: 0, detalle: `Precio ${c.price} fuera del rango` });
    } else {
      score += W.price;
      reasons.push({ factor: "precio", peso: W.price, detalle: `Precio dentro del rango` });
    }
  } else {
    score += W.price;
  }

  // Zona.
  if (req.zones.length && c.zone) {
    if (req.zones.some((z) => norm(z) === norm(c.zone!))) {
      score += W.zone;
      reasons.push({ factor: "zona", peso: W.zone, detalle: `Zona ${c.zone} buscada` });
    } else {
      reasons.push({ factor: "zona", peso: 0, detalle: `Zona ${c.zone} distinta` });
    }
  } else {
    score += W.zone;
  }

  // Ambientes y baños: mínimos.
  if (req.bedroomsMin != null && c.bedrooms != null) {
    if (c.bedrooms >= req.bedroomsMin) {
      score += W.bedrooms;
      reasons.push({ factor: "ambientes", peso: W.bedrooms, detalle: `${c.bedrooms} ambientes (mín. ${req.bedroomsMin})` });
    } else {
      reasons.push({ factor: "ambientes", peso: 0, detalle: `${c.bedrooms} ambientes, pide ${req.bedroomsMin}` });
    }
  } else {
    score += W.bedrooms;
  }
  if (req.bathroomsMin != null && c.bathrooms != null) {
    if (c.bathrooms >= req.bathroomsMin) score += W.bathrooms;
  } else {
    score += W.bathrooms;
  }

  // Superficie mínima.
  if (req.areaMin != null && c.areaM2 != null) {
    if (c.areaM2 >= req.areaMin) score += W.area;
  } else {
    score += W.area;
  }

  // Must-have: excluyente si falta alguno.
  const missing = req.mustHave.filter((f) => !hasFeature(c.features, f));
  if (req.mustHave.length && missing.length) {
    excluded = true;
    reasons.push({ factor: "requisitos", peso: 0, detalle: `Falta: ${missing.join(", ")}` });
  }

  // Nice-to-have: bonus (no sube de 1).
  const nice = req.niceToHave.filter((f) => hasFeature(c.features, f));
  if (nice.length) reasons.push({ factor: "deseables", peso: 0.05 * nice.length, detalle: `Suma: ${nice.join(", ")}` });
  const bonus = Math.min(0.1, 0.05 * nice.length);

  const finalScore = excluded ? 0 : Math.min(1, Number((score + bonus).toFixed(3)));
  return { score: finalScore, reasons, excluded };
}
