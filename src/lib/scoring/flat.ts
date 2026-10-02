import type { FlatValues } from "./profile";

// Las columnas planas de prospect_requirements como FlatValues. Sin base de datos: el tipo de la
// fila es estructural para poder usarlo también desde pruebas.
type RequirementLike = {
  operation: string | null;
  propertyTypes: string[];
  zones: string[];
  priceMin: string | null;
  priceMax: string | null;
  currency: string;
  bedroomsMin: number | null;
  bathroomsMin: number | null;
  areaMin: string | null;
  mustHave: string[];
  niceToHave: string[];
  rawExtraction: Record<string, unknown> | null;
};

const num = (v: string | null) => (v == null ? null : Number(v));

export function flatFromRow(r: RequirementLike): FlatValues {
  return {
    operation: r.operation,
    propertyTypes: r.propertyTypes,
    zones: r.zones,
    priceMin: num(r.priceMin),
    priceMax: num(r.priceMax),
    currency: r.currency,
    currencyExplicit: (r.rawExtraction ?? {}).moneda_explicita === true,
    bedroomsMin: r.bedroomsMin,
    bathroomsMin: r.bathroomsMin,
    areaMin: num(r.areaMin),
    mustHave: r.mustHave,
    niceToHave: r.niceToHave,
  };
}

export const emptyFlat = (): FlatValues => ({
  operation: null,
  propertyTypes: [],
  zones: [],
  priceMin: null,
  priceMax: null,
  currency: null,
  currencyExplicit: false,
  bedroomsMin: null,
  bathroomsMin: null,
  areaMin: null,
  mustHave: [],
  niceToHave: [],
});
