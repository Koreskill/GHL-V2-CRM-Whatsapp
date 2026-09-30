// Costo y personalización de una campaña. Lógica pura: sin base de datos ni red.
//
// El precio por mensaje NO es fijo ni universal: depende de la categoría de la plantilla, el país
// del destinatario y la tarifa vigente de Meta. Por eso se carga (o se confirma) en cada estimación
// y se guarda con su fuente y su fecha, para poder explicar el total después.

export type CostInput = { count: number; unitPrice: number; surchargePct: number; taxPct: number };

export type CostBreakdown = {
  subtotal: number;
  surcharge: number;
  tax: number;
  total: number;
  formula: string;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** subtotal = destinatarios × precio; recargo sobre el subtotal; impuestos sobre (subtotal + recargo). */
export function estimateCost({ count, unitPrice, surchargePct, taxPct }: CostInput): CostBreakdown {
  const subtotal = round2(count * unitPrice);
  const surcharge = round2(subtotal * (surchargePct / 100));
  const tax = round2((subtotal + surcharge) * (taxPct / 100));
  const total = round2(subtotal + surcharge + tax);
  return {
    subtotal,
    surcharge,
    tax,
    total,
    formula: `${count} × ${unitPrice} = ${subtotal}; + recargo ${surchargePct}% (${surcharge}); + impuestos ${taxPct}% (${tax}) = ${total}`,
  };
}

export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/**
 * Variables de la plantilla para un contacto. `{nombre}` se reemplaza por su primer nombre.
 * Si alguna variable queda vacía devuelve null: una variable vacía no se envía nunca.
 */
export function personalizeParams(params: string[], contactName: string | null | undefined): string[] | null {
  const name = firstName(contactName);
  const out = params.map((p) => p.replace(/\{nombre\}/gi, name).trim());
  return out.some((p) => !p) ? null : out;
}

export const usesName = (params: string[]) => params.some((p) => /\{nombre\}/i.test(p));

export type AudienceRow = { contactId: string; name: string | null; conversationId: string | null };

/** Separa a los elegibles de los excluidos y cuenta el motivo de cada exclusión. */
export function splitAudience(rows: AudienceRow[], params: string[]) {
  const eligible: (AudienceRow & { conversationId: string })[] = [];
  const excluded: Record<string, number> = {};
  const skip = (reason: string) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  };
  for (const r of rows) {
    if (!r.conversationId) skip("sin_whatsapp");
    else if (personalizeParams(params, r.name) === null) skip("variable_vacia");
    else eligible.push({ ...r, conversationId: r.conversationId });
  }
  return { eligible, excluded };
}

export const EXCLUSION_LABEL: Record<string, string> = {
  sin_whatsapp: "No tiene conversación de WhatsApp",
  variable_vacia: "Una variable de la plantilla queda vacía (por ejemplo, no tiene nombre)",
};
