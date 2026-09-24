"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import {
  BUTTON_TYPES,
  buildTemplateComponents,
  createTemplate,
  HEADER_FORMATS,
  type HeaderFormat,
  type TemplateButtonType,
  type TemplateDraft,
} from "@/lib/zernio/templates";
import type { CreateTemplateBody } from "@/lib/zernio/types";

const NAME = /^[a-z][a-z0-9_]{0,511}$/;
const LANGUAGES = new Set(["es_AR", "es", "es_MX", "es_ES", "en_US", "pt_BR"]);
const CATEGORIES = new Set(["UTILITY", "MARKETING"]);

export type CreateTemplateState = { error: string | null };

export async function createTemplateAction(_prev: CreateTemplateState, formData: FormData): Promise<CreateTemplateState> {
  const session = await requireRole("admin");
  if (!session) return { error: "Solo un administrador puede crear plantillas." };
  if (!rateLimit(`template-create:${session.user.id}`, 10, 60 * 60_000).ok) {
    return { error: "Creaste muchas plantillas seguidas. Espera un rato antes de crear otra." };
  }

  const accountId = String(formData.get("accountId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "");
  const language = String(formData.get("language") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const headerFormat = String(formData.get("headerFormat") ?? "none") as HeaderFormat;
  const headerText = String(formData.get("headerText") ?? "").trim();
  const headerExample = String(formData.get("headerExample") ?? "").trim();
  const footer = String(formData.get("footer") ?? "").trim();

  if (!NAME.test(name)) return { error: "El nombre va en minúsculas, sin espacios: letras, números y guion bajo (ej. seguimiento_visita)." };
  if (!CATEGORIES.has(category)) return { error: "Categoría inválida." };
  if (!LANGUAGES.has(language)) return { error: "Idioma inválido." };
  if (!body || body.length > 1024) return { error: "El mensaje es obligatorio y tiene un máximo de 1024 caracteres." };

  // Las variables tienen que ser {{1}}, {{2}}… consecutivas, y Meta exige un ejemplo para cada una.
  const vars = [...new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, ""))))].sort((a, b) => a - b);
  if (vars.some((v, i) => v !== i + 1)) return { error: "Las variables tienen que ser {{1}}, {{2}}, {{3}}… sin saltear números." };
  const examples = vars.map((v) => String(formData.get(`example_${v}`) ?? "").trim());
  if (examples.some((e) => !e)) return { error: "Completa un ejemplo para cada variable: Meta lo pide para aprobarla." };

  // Encabezado: texto (con una variable opcional) o un archivo de muestra para que Meta revise.
  if (!HEADER_FORMATS.includes(headerFormat)) return { error: "Formato de encabezado inválido." };
  let header: TemplateDraft["header"];
  if (headerFormat !== "none") {
    if (headerFormat === "text") {
      if (!headerText) return { error: "Escribe el texto del encabezado o quítalo." };
      if (headerText.length > 60) return { error: "El encabezado de texto admite hasta 60 caracteres." };
      // El encabezado admite UNA sola variable, y es {{1}} propio, no del cuerpo.
      const headerVars = headerText.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
      if (headerVars.length > 1) return { error: "El encabezado admite una sola variable." };
      if (headerVars.length === 1 && !/\{\{\s*1\s*\}\}/.test(headerText)) {
        return { error: "La variable del encabezado tiene que ser {{1}}." };
      }
      if (headerVars.length === 1 && !headerExample) {
        return { error: "Completa un ejemplo para la variable del encabezado." };
      }
      header = { format: "text", text: headerText, example: headerVars.length ? headerExample : undefined };
    } else {
      if (!headerExample) return { error: "Pega la URL de un archivo de muestra para el encabezado." };
      if (!/^https:\/\//i.test(headerExample)) return { error: "El archivo de muestra tiene que ser un enlace https." };
      header = { format: headerFormat, example: headerExample };
    }
  }

  if (footer.length > 60) return { error: "El pie admite hasta 60 caracteres." };

  // Botones: WhatsApp acepta hasta 10, pero uno solo de teléfono y hasta dos de URL.
  const buttons: NonNullable<TemplateDraft["buttons"]> = [];
  for (let i = 0; i < 3; i++) {
    const type = String(formData.get(`buttonType_${i}`) ?? "") as TemplateButtonType;
    const text = String(formData.get(`buttonText_${i}`) ?? "").trim();
    if (!type || !BUTTON_TYPES.includes(type)) continue;
    if (!text) return { error: `Escribe la etiqueta del botón ${i + 1} o quítalo.` };
    if (text.length > 25) return { error: "La etiqueta de un botón admite hasta 25 caracteres." };

    if (type === "url") {
      const url = String(formData.get(`buttonUrl_${i}`) ?? "").trim();
      if (!/^https:\/\//i.test(url)) return { error: `El botón "${text}" necesita un enlace https.` };
      buttons.push({ type, text, url });
    } else if (type === "phone_number") {
      const phone = String(formData.get(`buttonPhone_${i}`) ?? "").trim();
      if (!/^\+?\d{8,15}$/.test(phone)) return { error: `El botón "${text}" necesita un teléfono válido.` };
      buttons.push({ type, text, phoneNumber: phone });
    } else {
      buttons.push({ type, text });
    }
  }
  if (buttons.filter((b) => b.type === "phone_number").length > 1) {
    return { error: "WhatsApp admite un solo botón de teléfono por plantilla." };
  }
  if (buttons.filter((b) => b.type === "url").length > 2) {
    return { error: "WhatsApp admite hasta dos botones de enlace por plantilla." };
  }

  const [account] = await getDb()
    .select()
    .from(channelAccounts)
    .where(
      and(
        eq(channelAccounts.id, accountId),
        eq(channelAccounts.channel, "whatsapp"),
        eq(channelAccounts.organizationId, session.organizationId),
      ),
    );
  if (!account) return { error: "Cuenta de WhatsApp inválida." };

  const res = await createTemplate({
    accountId: account.externalId,
    name,
    category: category as "UTILITY" | "MARKETING",
    language,
    components: buildTemplateComponents({
      body,
      bodyExamples: examples,
      header,
      footer: footer || undefined,
      buttons: buttons.length ? buttons : undefined,
    }) as CreateTemplateBody["components"],
  });
  if (!res.success) {
    // El mensaje de Meta/Zernio explica por qué la rechaza (nombre repetido, formato); no expone nada interno.
    return { error: `Meta no aceptó la plantilla: ${res.error.message}` };
  }
  redirect(`/plantillas?created=${encodeURIComponent(name)}`);
}
