// Configuración ÚNICA del puntaje de compatibilidad propiedad ↔ contacto. Ni la fórmula ni la
// interfaz tienen pesos o umbrales escritos adentro: todo se ajusta acá.
//
// El puntaje NO es una calidad de la propiedad. Mide qué tan bien encaja con lo que ESTE contacto
// dijo; la misma propiedad tiene puntajes distintos para contactos distintos.

export const SCORING = {
  /** Reparto de los 100 puntos entre grupos de criterios. Tiene que sumar 100. */
  weights: {
    location: 25,
    budget: 25,
    type: 15,
    bedrooms: 10,
    surface: 10,
    amenities: 10,
    other: 5,
  },

  /** Bandas de compatibilidad. Es solo cómo se muestra: no hay propiedades "buenas" o "malas". */
  bands: { strong: 80, possible: 60, weak: 40 },

  budget: {
    /** Cuánto sobre el máximo todavía cuenta, SOLO si el contacto dijo que el presupuesto es flexible. */
    flexibleTolerance: 0.15,
    /** Crédito parcial que recibe una propiedad justo en el borde de esa tolerancia (1 = completo). */
    flexibleEdgeCredit: 0.5,
    /** Una propiedad por debajo del mínimo que dijo no es un conflicto duro: conserva este crédito. */
    belowMinCredit: 0.6,
  },

  /** Un conflicto DURO resta esto y además topa el puntaje: no puede quedar como "buena opción". */
  hardConflictPenalty: 35,
  hardConflictCap: 39,

  /**
   * Qué criterios son duros cuando el contacto NO aclaró si lo eran. null/false = blando.
   * La operación nunca se mezcla (venta vs alquiler). El presupuesto máximo NO es duro por defecto:
   * solo si el contacto dijo que no puede pasarse. Los amenities "requeridos" lo son por definición.
   */
  defaultHard: {
    operation: true,
    propertyTypes: false,
    zones: false,
    budgetMax: false,
    bedroomsMin: false,
    bathroomsMin: false,
    surfaceMin: false,
    requiredAmenities: true,
    excludedFeatures: false,
  } as Record<string, boolean>,

  /** Un contacto con perfil de este tamaño ya tiene confianza completa en lo que sabemos. */
  confidenceFullAt: 1,

  /** Cuánto se guarda por conversación. */
  minStoredScore: 20,
  maxStoredPerKind: 30,

  /** Confianza que se asume para un dato que ya estaba en el perfil sin procedencia registrada. */
  legacyConfidence: 0.6,
  /** Confianza de lo que escribe una persona: manda sobre lo automático. */
  manualConfidence: 1,
} as const;

/**
 * Relaciones EXPLÍCITAS entre zonas (acepta X, también sirve Y). Vacío a propósito: no se infiere
 * que dos barrios son "cerca" por nombre. Si la inmobiliaria define relaciones, van acá o en su
 * propia configuración; cada una da crédito parcial.
 */
export const ZONE_RELATIONS: Record<string, string[]> = {};
export const NEARBY_ZONE_CREDIT = 0.5;

/** Sinónimos de amenities (normalizados, sin tildes). Cada fila es UN mismo concepto. */
export const AMENITY_SYNONYMS: string[][] = [
  ["pileta", "piscina", "pool", "natatorio"],
  ["cochera", "garage", "garaje", "estacionamiento", "parking"],
  ["jardin", "garden", "patio"],
  ["quincho", "parrilla", "asador"],
  ["balcon", "terraza", "balcon terraza"],
  ["seguridad", "vigilancia", "barrio cerrado", "country"],
  ["gimnasio", "gym"],
  ["sum", "salon de usos multiples"],
  ["ascensor", "elevador"],
  ["baulera", "bauleras"],
  ["aire acondicionado", "a/a", "aire"],
  ["calefaccion", "losa radiante"],
  ["amoblado", "amueblado", "equipado"],
];

export function validateWeights(w: Record<string, number> = SCORING.weights): number {
  return Object.values(w).reduce((a, b) => a + b, 0);
}

export type Band = "strong" | "possible" | "weak" | "low";

export function bandOf(score: number): Band {
  if (score >= SCORING.bands.strong) return "strong";
  if (score >= SCORING.bands.possible) return "possible";
  if (score >= SCORING.bands.weak) return "weak";
  return "low";
}

export const BAND_LABEL: Record<Band, string> = {
  strong: "Compatibilidad alta",
  possible: "Compatibilidad posible",
  weak: "Compatibilidad baja",
  low: "Poca compatibilidad",
};
