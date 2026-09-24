"use server";

import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { createTemplate } from "@/lib/zernio/templates";

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

  if (!NAME.test(name)) return { error: "El nombre va en minúsculas, sin espacios: letras, números y guion bajo (ej. seguimiento_visita)." };
  if (!CATEGORIES.has(category)) return { error: "Categoría inválida." };
  if (!LANGUAGES.has(language)) return { error: "Idioma inválido." };
  if (!body || body.length > 1024) return { error: "El mensaje es obligatorio y tiene un máximo de 1024 caracteres." };

  // Las variables tienen que ser {{1}}, {{2}}… consecutivas, y Meta exige un ejemplo para cada una.
  const vars = [...new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, ""))))].sort((a, b) => a - b);
  if (vars.some((v, i) => v !== i + 1)) return { error: "Las variables tienen que ser {{1}}, {{2}}, {{3}}… sin saltear números." };
  const examples = vars.map((v) => String(formData.get(`example_${v}`) ?? "").trim());
  if (examples.some((e) => !e)) return { error: "Completa un ejemplo para cada variable: Meta lo pide para aprobarla." };

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
    components: [{ type: "body", text: body, ...(vars.length ? { example: { body_text: [examples] } } : {}) }],
  });
  if (!res.success) {
    // El mensaje de Meta/Zernio explica por qué la rechaza (nombre repetido, formato); no expone nada interno.
    return { error: `Meta no aceptó la plantilla: ${res.error.message}` };
  }
  redirect(`/plantillas?created=${encodeURIComponent(name)}`);
}
