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
