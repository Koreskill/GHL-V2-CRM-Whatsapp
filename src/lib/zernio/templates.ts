import { zernioRequest } from "./client";
import type { CreateTemplateBody, CreateTemplateResponse, ListTemplatesQuery, ListTemplatesResponse } from "./types";

export function listTemplates(query: ListTemplatesQuery) {
  return zernioRequest<ListTemplatesResponse>("GET", "/v1/whatsapp/templates", { query });
}

export function createTemplate(body: CreateTemplateBody) {
  return zernioRequest<CreateTemplateResponse>("POST", "/v1/whatsapp/templates", { body });
}

type Component = { type?: string; text?: string; format?: string };

// Meta devuelve los componentes con `type` en mayúsculas (BODY, HEADER…); se compara sin distinguir.
export function templateBody(t: { components?: unknown }): string {
  const body = (Array.isArray(t.components) ? (t.components as Component[]) : []).find((c) => c.type?.toLowerCase() === "body");
  return body?.text ?? "";
}

// Cantidad de variables posicionales {{1}}, {{2}}… del cuerpo.
export function templateParamCount(t: { components?: unknown }): number {
  const matches = templateBody(t).match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  return matches.reduce((max, m) => Math.max(max, Number(m.replace(/\D/g, ""))), 0);
}

export function renderTemplate(t: { components?: unknown }, params: string[]): string {
  return templateBody(t).replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => params[Number(n) - 1] ?? `{{${n}}}`);
}

// ─── Composición de plantillas (Fase 12) ────────────────────────────────────
// Lo que se puede mandar sale del OpenAPI de Zernio 1.62.0, no de suposiciones:
// componentes header | body | footer | buttons | carousel | limited_time_offer,
// formatos de header text | image | video | gif | document | location, y botones
// quick_reply | url | phone_number | otp | copy_code | flow | mpm | catalog.
//
// Acá se cubren header (texto o media), footer y los tres tipos de botón que usa una
// inmobiliaria. Carrusel y oferta por tiempo limitado quedan fuera hasta tener el indicativo
// de formatos: arman su propia estructura y aprobarlos mal cuesta el rechazo de Meta.

export const HEADER_FORMATS = ["none", "text", "image", "video", "document"] as const;
export type HeaderFormat = (typeof HEADER_FORMATS)[number];

export const BUTTON_TYPES = ["quick_reply", "url", "phone_number"] as const;
export type TemplateButtonType = (typeof BUTTON_TYPES)[number];

export type TemplateDraft = {
  body: string;
  bodyExamples: string[];
  header?: { format: Exclude<HeaderFormat, "none">; text?: string; example?: string };
  footer?: string;
  buttons?: { type: TemplateButtonType; text: string; url?: string; phoneNumber?: string; example?: string }[];
};

type BuiltComponent = Record<string, unknown>;

// Arma los componentes tal como los espera la API. El orden importa: Meta los muestra así.
export function buildTemplateComponents(draft: TemplateDraft): BuiltComponent[] {
  const components: BuiltComponent[] = [];

  if (draft.header) {
    const header: BuiltComponent = { type: "header", format: draft.header.format };
    if (draft.header.format === "text") {
      header.text = draft.header.text;
      // Una variable en el encabezado necesita su ejemplo, como las del cuerpo.
      if (draft.header.example) header.example = { header_text: [draft.header.example] };
    } else if (draft.header.example) {
      // Para media, el ejemplo es la URL del archivo de muestra que Meta usa al revisar.
      header.example = { header_handle: [draft.header.example] };
    }
    components.push(header);
  }

  const body: BuiltComponent = { type: "body", text: draft.body };
  if (draft.bodyExamples.length) body.example = { body_text: [draft.bodyExamples] };
  components.push(body);

  if (draft.footer) components.push({ type: "footer", text: draft.footer });

  if (draft.buttons?.length) {
    components.push({
      type: "buttons",
      buttons: draft.buttons.map((b) => {
        if (b.type === "url") {
          return { type: "url", text: b.text, url: b.url, ...(b.example ? { example: [b.example] } : {}) };
        }
        if (b.type === "phone_number") return { type: "phone_number", text: b.text, phone_number: b.phoneNumber };
        return { type: "quick_reply", text: b.text };
      }),
    });
  }

  return components;
}

// ─── Lectura de una plantilla ya aprobada ───────────────────────────────────

type AnyComponent = {
  type?: string;
  format?: string;
  text?: string;
  buttons?: { type?: string; text?: string; url?: string; phone_number?: string }[];
};

const componentsOf = (t: { components?: unknown }): AnyComponent[] =>
  Array.isArray(t.components) ? (t.components as AnyComponent[]) : [];

const find = (t: { components?: unknown }, type: string) =>
  componentsOf(t).find((c) => c.type?.toLowerCase() === type);

export function templateHeader(t: { components?: unknown }) {
  const header = find(t, "header");
  if (!header) return null;
  return { format: (header.format ?? "text").toLowerCase(), text: header.text ?? null };
}

export function templateFooter(t: { components?: unknown }): string | null {
  return find(t, "footer")?.text ?? null;
}

export function templateButtons(t: { components?: unknown }) {
  return (find(t, "buttons")?.buttons ?? []).map((b) => ({
    type: (b.type ?? "quick_reply").toLowerCase(),
    text: b.text ?? "",
    url: b.url ?? null,
    phoneNumber: b.phone_number ?? null,
  }));
}

// Vista previa completa: encabezado, cuerpo con las variables resueltas, pie y botones.
export function renderTemplatePreview(t: { components?: unknown }, params: string[]) {
  const header = templateHeader(t);
  return {
    header: header
      ? {
          format: header.format,
          // El encabezado usa {{1}} propio, no comparte numeración con el cuerpo.
          text: header.text?.replace(/\{\{\s*1\s*\}\}/g, params[0] ?? "{{1}}") ?? null,
        }
      : null,
    body: renderTemplate(t, params),
    footer: templateFooter(t),
    buttons: templateButtons(t),
  };
}

/**
 * Comprueba que se pueda enviar con datos REALES.
 * Si falta una variable, avisa en lugar de mandar un mensaje con "{{2}}" adentro o un hueco.
 */
export function validateTemplateParams(t: { components?: unknown }, params: string[]): string | null {
  const needed = templateParamCount(t);
  for (let i = 0; i < needed; i++) {
    if (!params[i]?.trim()) return `Falta el dato de la variable {{${i + 1}}}: completalo antes de enviar.`;
  }
  return null;
}
