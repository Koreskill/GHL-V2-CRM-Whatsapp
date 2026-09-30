"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { cancelBatch, createEstimate, freezeAndConfirm, getBatch, runBatch, sendingEnabled } from "@/lib/campaigns/batches";
import { parseContactFilters } from "@/lib/crm/contact-filters";
import { listTemplates, templateParamCount } from "@/lib/zernio/templates";

const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);
const pct = (raw: string) => {
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 0;
};

async function adminOrRedirect() {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  return session;
}

// Estimar: calcula destinatarios elegibles y costo. No congela audiencia ni envía nada.
export async function createEstimateAction(formData: FormData) {
  const session = await adminOrRedirect();
  const orgId = session.organizationId;
  const back = (error: string): never => redirect(`/contactos/campanas/nueva?${text(formData, "f", 2000)}&error=${encodeURIComponent(error)}`);

  const name = text(formData, "name", 80);
  if (!name) back("Poné un nombre para identificar la campaña.");
  const [templateName, templateLanguage] = text(formData, "template", 200).split("|");
  if (!templateName || !templateLanguage) back("Elegí una plantilla.");

  const unit = Number(text(formData, "unitPrice", 20).replace(",", "."));
  if (!Number.isFinite(unit) || unit < 0) back("El precio por mensaje no es válido.");
  const currency = text(formData, "currency", 3) === "ARS" ? "ARS" : "USD";
  const params = text(formData, "params", 1500).split("\n").map((p) => p.trim()).filter(Boolean);

  // La plantilla tiene que existir, estar aprobada y tener tantas variables como se cargaron.
  const accounts = await getDb()
    .select({ externalId: channelAccounts.externalId })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.organizationId, orgId), eq(channelAccounts.channel, "whatsapp"), eq(channelAccounts.status, "connected")));
  let found: { components?: unknown } | undefined;
  for (const a of accounts) {
    const res = await listTemplates({ accountId: a.externalId, name: templateName, language: templateLanguage, status: "APPROVED" });
    found = res.success ? res.data.templates?.find((t) => t.name === templateName && t.language === templateLanguage && t.status === "APPROVED") : undefined;
    if (found) break;
  }
  if (!found) back("La plantilla no existe o todavía no está aprobada por Meta.");
  const expected = templateParamCount(found!);
  if (params.length !== expected) back(`La plantilla necesita ${expected} ${expected === 1 ? "variable" : "variables"} (una por línea).`);

  const filters = parseContactFilters(Object.fromEntries(new URLSearchParams(text(formData, "f", 2000))));
  const batch = await createEstimate({
    orgId,
    userId: session.user.id,
    name,
    templateName,
    templateLanguage,
    params,
    filters,
    currency,
    unitPrice: unit,
    taxPct: pct(text(formData, "taxPct", 8)),
    surchargePct: pct(text(formData, "surchargePct", 8)),
  });
  redirect(`/contactos/campanas/${batch.id}`);
}

function batchIdOf(formData: FormData) {
  const id = text(formData, "batchId", 64);
  if (!isUuid(id)) redirect("/contactos/campanas");
  return id;
}

export async function confirmBatchAction(formData: FormData) {
  const session = await adminOrRedirect();
  const batchId = batchIdOf(formData);
  const res = await freezeAndConfirm(session.organizationId, session.user.id, batchId, Number(text(formData, "typed", 10)));
  revalidatePath(`/contactos/campanas/${batchId}`);
  redirect(`/contactos/campanas/${batchId}${res.ok ? "" : `?error=${encodeURIComponent(res.error)}`}`);
}

// Enviar: solo un lote CONFIRMADO, y solo si el envío real está habilitado en el servidor.
export async function sendBatchAction(formData: FormData) {
  const session = await adminOrRedirect();
  const batchId = batchIdOf(formData);
  const batch = await getBatch(session.organizationId, batchId);
  const back = (error?: string) => redirect(`/contactos/campanas/${batchId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
  if (!batch || (batch.status !== "confirmada" && batch.status !== "enviando")) back("El lote no está listo para enviar.");
  if (!sendingEnabled()) back("El envío de campañas está deshabilitado en el servidor (CAMPAIGNS_SEND_ENABLED).");

  const orgId = session.organizationId;
  after(async () => {
    await runBatch(orgId, batchId).catch((err: unknown) => console.error("[campanas] falló el lote", err instanceof Error ? err.message : "error"));
  });
  back();
}

export async function cancelBatchAction(formData: FormData) {
  const session = await adminOrRedirect();
  const batchId = batchIdOf(formData);
  await cancelBatch(session.organizationId, batchId);
  revalidatePath(`/contactos/campanas/${batchId}`);
  redirect(`/contactos/campanas/${batchId}`);
}
