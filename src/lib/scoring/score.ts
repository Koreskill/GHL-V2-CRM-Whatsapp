import { AMENITY_SYNONYMS, NEARBY_ZONE_CREDIT, SCORING, ZONE_RELATIONS, bandOf, type Band } from "./config";
import type { Criterion, CriterionKey, LeadProfile } from "./profile";

// Puntaje de compatibilidad: código determinista sobre el perfil estructurado. NINGÚN modelo pone el
// número. Cada punto se explica con una frase generada en la misma pasada que lo calcula, así la
// explicación y el puntaje no pueden contradecirse.

export type Candidate = {
  kind: "cartera" | "red";
  id: string;
  operation: string;
  propertyType: string;
  zone: string | null;
  city: string | null;
  price: number | null;
  currency: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaM2: number | null;
  parking: number | null;
  /** Amenities declarados. Lista vacía = no se sabe, NO "no tiene ninguno". */
  amenities: string[];
};

export type GroupKey = keyof typeof SCORING.weights;

export type GroupResult = {
  weight: number;
  /** El contacto dijo algo de este grupo Y la propiedad tiene el dato para compararlo. */
  known: boolean;
  /** 0–1. */
  earned: number;
  points: number;
};

export type ScoreResult = {
  score: number;
  /** Cuánto sabemos del contacto (0–1). Sube a medida que da más datos. */
  confidence: number;
  matched: string[];
  conflicting: string[];
  missing: string[];
  hardConflicts: string[];
  band: Band;
  breakdown: {
    groups: Record<GroupKey, GroupResult>;
    base: number;
    penalty: number;
    coverage: number;
    avgConfidence: number;
  };
};

type Item = { group: GroupKey; weight: number; earned: number; confidence: number };

export const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const money = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString("es-AR")}`;

function conceptOf(name: string): string {
  const n = norm(name);
  const row = AMENITY_SYNONYMS.find((r) => r.some((x) => norm(x) === n));
  return row ? norm(row[0]) : n;
}

function hasAmenity(c: Candidate, wanted: string): boolean | null {
  const concept = conceptOf(wanted);
  if (c.amenities.some((a) => conceptOf(a) === concept)) return true;
  // La cochera también está en su propio campo numérico.
  if (concept === "cochera" && c.parking != null) return c.parking > 0 ? true : c.amenities.length ? false : null;
  // Lista vacía = sin datos: no se puede afirmar que no lo tiene.
  return c.amenities.length === 0 ? null : false;
}

const isHard = (crit: Criterion<unknown> | undefined, key: string): boolean =>
  crit ? crit.strict === true || (crit.strict === null && SCORING.defaultHard[key] === true) : false;

/**
 * null = no se sugiere: venta y alquiler nunca se mezclan (la operación es un criterio duro que
 * descarta, no solo resta).
 */
export function scoreCandidate(profile: LeadProfile, c: Candidate): ScoreResult | null {
  if (profile.operation && norm(profile.operation.value) !== norm(c.operation)) return null;

  const matched: string[] = [];
  const conflicting: string[] = [];
  const missing: string[] = [];
  const hard: string[] = [];
  const items: Item[] = [];
  const add = (group: GroupKey, weight: number, earned: number, crit: { confidence: number }) =>
    items.push({ group, weight, earned: Math.max(0, Math.min(1, earned)), confidence: crit.confidence });

  const conflict = (msg: string, crit: Criterion<unknown> | undefined, key: string) => {
    conflicting.push(msg);
    if (isHard(crit, key)) hard.push(msg);
  };

  // ── Ubicación ──
  if (profile.zones) {
    const zone = c.zone ? norm(c.zone) : "";
    const city = c.city ? norm(c.city) : "";
    if (!zone && !city) missing.push("La propiedad no tiene zona cargada");
    else {
      const wanted = profile.zones.value.map(norm);
      const hit = wanted.find((w) => w && ((zone && (zone === w || zone.includes(w) || w.includes(zone))) || (city && (city === w || city.includes(w)))));
      if (hit) {
        add("location", 1, 1, profile.zones);
        matched.push(`Zona ${c.zone ?? c.city}`);
      } else {
        // Solo hay crédito parcial si existe una relación EXPLÍCITA entre zonas: no se infiere por nombre.
        const related = wanted.some((w) => (ZONE_RELATIONS[w] ?? []).map(norm).some((r) => r === zone || r === city));
        if (related) {
          add("location", NEARBY_ZONE_CREDIT, NEARBY_ZONE_CREDIT, profile.zones);
          matched.push(`Zona cercana aceptada (${c.zone ?? c.city})`);
        } else {
          add("location", 1, 0, profile.zones);
          conflict(`Otra zona (${c.zone ?? c.city})`, profile.zones, "zones");
        }
      }
    }
  }
  if (profile.province) missing.push("Provincia sin comparar: la propiedad no la registra");

  // ── Presupuesto ──
  if (profile.budgetMax || profile.budgetMin) {
    const wantedCurrency = profile.currency;
    if (c.price == null || c.price <= 0) missing.push("La propiedad no tiene precio cargado");
    else if (wantedCurrency && wantedCurrency !== c.currency) missing.push(`Moneda distinta (${c.currency} vs ${wantedCurrency}): precio sin comparar`);
    else {
      const max = profile.budgetMax?.value;
      const min = profile.budgetMin?.value;
      const crit = (profile.budgetMax ?? profile.budgetMin)!;
      if (max != null && c.price > max) {
        const over = (c.price - max) / max;
        const pct = Math.round(over * 100);
        if (profile.budgetFlexible?.value === true && over <= SCORING.budget.flexibleTolerance) {
          // Flexible: solo si el contacto lo dijo. Cuanto más se aleja, menos crédito.
          const credit = 1 - (over / SCORING.budget.flexibleTolerance) * (1 - SCORING.budget.flexibleEdgeCredit);
          add("budget", 1, credit, crit);
          matched.push(`${pct}% sobre el presupuesto, que es flexible (${money(c.price, c.currency)})`);
        } else {
          add("budget", 1, 0, crit);
          conflict(`Supera el presupuesto: ${money(c.price, c.currency)} (máx. ${money(max, c.currency)})`, profile.budgetMax, "budgetMax");
        }
      } else if (min != null && c.price < min) {
        add("budget", 1, SCORING.budget.belowMinCredit, crit);
        conflicting.push(`Por debajo del mínimo (${money(c.price, c.currency)})`); // nunca es un conflicto duro
      } else {
        add("budget", 1, 1, crit);
        matched.push(`Dentro del presupuesto (${money(c.price, c.currency)})`);
      }
    }
  }

  // ── Tipo ──
  if (profile.propertyTypes) {
    if (profile.propertyTypes.value.map(norm).includes(norm(c.propertyType))) {
      add("type", 1, 1, profile.propertyTypes);
      matched.push(`Es ${c.propertyType}`);
    } else {
      add("type", 1, 0, profile.propertyTypes);
      conflict(`Es ${c.propertyType}, busca ${profile.propertyTypes.value.join(" o ")}`, profile.propertyTypes, "propertyTypes");
    }
  }

  // ── Dormitorios y baños (capacidad) ──
  const capacity: { earned: number; crit: Criterion<number> }[] = [];
  const minCheck = (label: string, want: Criterion<number> | undefined, have: number | null, key: string) => {
    if (!want) return;
    if (have == null) {
      missing.push(`La propiedad no informa ${label}`);
      return;
    }
    const diff = want.value - have;
    if (diff <= 0) {
      capacity.push({ earned: 1, crit: want });
      matched.push(`${have} ${label}`);
    } else {
      capacity.push({ earned: diff === 1 ? 0.4 : 0, crit: want });
      conflict(`${have} ${label} (pide ${want.value} o más)`, want, key);
    }
  };
  minCheck(c.bedrooms === 1 ? "dormitorio" : "dormitorios", profile.bedroomsMin, c.bedrooms, "bedroomsMin");
  minCheck(c.bathrooms === 1 ? "baño" : "baños", profile.bathroomsMin, c.bathrooms, "bathroomsMin");
  if (capacity.length) {
    const avg = capacity.reduce((s, x) => s + x.earned, 0) / capacity.length;
    add("bedrooms", 1, avg, { confidence: capacity.reduce((s, x) => s + x.crit.confidence, 0) / capacity.length });
  }

  // ── Superficie ──
  if (profile.surfaceMin) {
    if (c.areaM2 == null) missing.push("La propiedad no informa superficie");
    else if (c.areaM2 >= profile.surfaceMin.value) {
      add("surface", 1, 1, profile.surfaceMin);
      matched.push(`${c.areaM2} m²`);
    } else {
      const near = c.areaM2 >= profile.surfaceMin.value * 0.9;
      add("surface", 1, near ? 0.5 : 0, profile.surfaceMin);
      conflict(`${c.areaM2} m² (pide ${profile.surfaceMin.value} o más)`, profile.surfaceMin, "surfaceMin");
    }
  }

  // ── Amenities: requeridos pesan el doble que los preferidos ──
  const am: { earned: number; w: number; crit: Criterion<string[]> }[] = [];
  for (const wanted of profile.requiredAmenities?.value ?? []) {
    const has = hasAmenity(c, wanted);
    if (has === null) missing.push(`Sin confirmar ${wanted} (lo necesita)`);
    else if (has) {
      am.push({ earned: 1, w: 2, crit: profile.requiredAmenities! });
      matched.push(`Tiene ${wanted}`);
    } else {
      am.push({ earned: 0, w: 2, crit: profile.requiredAmenities! });
      conflict(`No tiene ${wanted} (lo necesita)`, profile.requiredAmenities, "requiredAmenities");
    }
  }
  for (const wanted of profile.preferredAmenities?.value ?? []) {
    const has = hasAmenity(c, wanted);
    if (has === null) missing.push(`Sin confirmar ${wanted}`);
    else if (has) {
      am.push({ earned: 1, w: 1, crit: profile.preferredAmenities! });
      matched.push(`Tiene ${wanted}`);
    } else {
      am.push({ earned: 0, w: 1, crit: profile.preferredAmenities! });
      conflicting.push(`No tiene ${wanted}`);
    }
  }
  if (am.length) {
    const total = am.reduce((s, x) => s + x.w, 0);
    add("amenities", 1, am.reduce((s, x) => s + x.earned * x.w, 0) / total, { confidence: am.reduce((s, x) => s + x.crit.confidence * x.w, 0) / total });
  }

  // ── Otras preferencias: lo que NO quiere ──
  const ex: number[] = [];
  for (const unwanted of profile.excludedFeatures?.value ?? []) {
    const has = hasAmenity(c, unwanted);
    if (has === null) missing.push(`Sin confirmar que no tenga ${unwanted}`);
    else if (has) {
      ex.push(0);
      conflict(`Tiene ${unwanted}, que no quiere`, profile.excludedFeatures, "excludedFeatures");
    } else {
      ex.push(1);
      matched.push(`Sin ${unwanted}`);
    }
  }
  if (ex.length) add("other", 1, ex.reduce((a, b) => a + b, 0) / ex.length, profile.excludedFeatures!);

  // Lo que el contacto todavía no dijo: no resta, se anota como dato que falta.
  if (!profile.zones) missing.push("Zona sin definir");
  if (!profile.budgetMax && !profile.budgetMin) missing.push("Presupuesto sin definir");
  if (!profile.propertyTypes) missing.push("Tipo de propiedad sin definir");
  if (!profile.bedroomsMin) missing.push("Dormitorios sin definir");
  if (!profile.operation) missing.push("Operación sin definir");

  // ── Puntaje: solo cuentan los grupos conocidos; lo desconocido no penaliza ──
  const W = SCORING.weights;
  const groups = {} as Record<GroupKey, GroupResult>;
  let sumKnown = 0;
  let sumPoints = 0;
  for (const g of Object.keys(W) as GroupKey[]) {
    const mine = items.filter((i) => i.group === g);
    const known = mine.length > 0;
    const earned = known ? mine.reduce((s, i) => s + i.earned, 0) / mine.length : 0;
    groups[g] = { weight: W[g], known, earned, points: known ? earned * W[g] : 0 };
    if (known) {
      sumKnown += W[g];
      sumPoints += earned * W[g];
    }
  }

  // Sin ningún criterio comparable no hay base para un puntaje.
  if (sumKnown === 0) return null;
  const base = (sumPoints / sumKnown) * 100;
  const penalty = hard.length * SCORING.hardConflictPenalty;
  let score = Math.max(0, base - penalty);
  if (hard.length) score = Math.min(score, SCORING.hardConflictCap);
  score = Math.round(Math.max(0, Math.min(100, score)));

  // Confianza: cuánto del perfil conocemos (qué fracción de los 100 puntos el CONTACTO definió) por
  // qué tan seguros estamos de lo que extrajimos. Sube sola con cada dato nuevo.
  const lead = leadCoverage(profile);
  const confs = items.map((i) => i.confidence);
  const avgConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  const confidence = Math.round(Math.min(1, lead.coverage / SCORING.confidenceFullAt) * avgConfidence * 1000) / 1000;

  return {
    score,
    confidence,
    matched,
    conflicting,
    missing,
    hardConflicts: hard,
    band: bandOf(score),
    breakdown: { groups, base: Math.round(base * 10) / 10, penalty, coverage: lead.coverage, avgConfidence: Math.round(avgConfidence * 1000) / 1000 },
  };
}

/** Qué fracción de los 100 puntos corresponde a grupos sobre los que el contacto ya dijo algo. */
export function leadCoverage(p: LeadProfile): { coverage: number; groups: GroupKey[] } {
  const has: Record<GroupKey, boolean> = {
    location: Boolean(p.zones),
    budget: Boolean(p.budgetMax || p.budgetMin),
    type: Boolean(p.propertyTypes),
    bedrooms: Boolean(p.bedroomsMin || p.bathroomsMin),
    surface: Boolean(p.surfaceMin),
    amenities: Boolean(p.requiredAmenities || p.preferredAmenities),
    other: Boolean(p.excludedFeatures),
  };
  const total = Object.values(SCORING.weights).reduce((a, b) => a + b, 0);
  const groups = (Object.keys(has) as GroupKey[]).filter((g) => has[g]);
  return { coverage: groups.reduce((s, g) => s + SCORING.weights[g], 0) / total, groups };
}

export type { CriterionKey };
