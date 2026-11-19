"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { isUuid } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeAudit } from "@/lib/agency/queries";
import { cancelBatch, createEstimate, freezeAndConfirm, pauseBatch, resumeBatch, sendingEnabled, startBatch } from "@/lib/campaigns/batches";
import { parseContactFilters } from "@/lib/crm/contact-filters";
import { cleanIds } from "@/lib/crm/groups";
import { wallTimeToDate } from "@/lib/tz";
import { listTemplates, templateParamCount } from "@/lib/zernio/templates";

// Campañas: SOLO administradores. Se valida acá, en el servidor, en cada acción (la interfaz además
// esconde el menú, pero eso no protege nada). La organización sale siempre de la sesión.

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
  const back = (error: string): never => redirect(`/contactos/campanas/nueva?${text(formData, "q", 3000)}&error=${encodeURIComponent(error)}`);

  const name = text(formData, "name", 80);
  if (!name) back("Poné un nombre para identificar la campaña.");
  const [templateName, templateLanguage] = text(formData, "template", 200).split("|");
  if (!templateName || !templateLanguage) back("Elegí una plantilla.");

  const unit = Number(text(formData, "unitPrice", 20).replace(",", "."));
  if (!Number.isFinite(unit) || unit < 0) back("El precio por mensaje no es válido.");
  const currency = text(formData, "currency", 3) === "ARS" ? "ARS" : "USD";
  const params = text(formData, "params", 1500).split("\n").map((p) => p.trim()).filter(Boolean);

  // Cuenta emisora: tiene que ser de esta inmobiliaria, de WhatsApp y estar conectada.
  const accountId = text(formData, "account", 64);
  if (!isUuid(accountId)) back("Elegí la cuenta de WhatsApp que envía.");
  const [account] = await getDb()
    .select({ id: channelAccounts.id, externalId: channelAccounts.externalId, status: channelAccounts.status })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, accountId), eq(channelAccounts.organizationId, orgId), eq(channelAccounts.channel, "whatsapp")));
  if (!account) back("La cuenta emisora no es de esta inmobiliaria.");
  if (account!.status !== "connected") back("La cuenta emisora está desconectada.");

  // La plantilla tiene que existir EN ESA cuenta, estar aprobada y tener tantas variables como se cargaron.
  const res = await listTemplates({ accountId: account!.externalId, name: templateName, language: templateLanguage, status: "APPROVED" });
  const found = res.success ? res.data.templates?.find((t) => t.name === templateName && t.language === templateLanguage && t.status === "APPROVED") : undefined;
  if (!found) back("La plantilla no existe en esa cuenta o todavía no está aprobada por Meta.");
  const expected = templateParamCount(found!);
  if (params.length !== expected) back(`La plantilla necesita ${expected} ${expected === 1 ? "variable" : "variables"} (una por línea).`);

  const q = new URLSearchParams(text(formData, "q", 3000));
  const filters = parseContactFilters(Object.fromEntries(q));
  const sources = { groupIds: cleanIds(q.getAll("g")), labelIds: cleanIds(q.getAll("l")), segmentIds: cleanIds(q.getAll("s")) };
  const r = await createEstimate({
    orgId,
    userId: session.user.id,
    name,
    channelAccountId: account!.id,
    templateName,
    templateLanguage,
    params,
    filters,
    sources,
    currency,
    unitPrice: unit,
    taxPct: pct(text(formData, "taxPct", 8)),
    surchargePct: pct(text(formData, "surchargePct", 8)),
  });
  if (!r.ok) back(r.error);
  redirect(`/contactos/campanas/${(r as { batch: { id: string } }).batch.id}`);
}

function batchIdOf(formData: FormData) {
  const id = text(formData, "batchId", 64);
  if (!isUuid(id)) redirect("/contactos/campanas");
  return id;
}

const goBatch = (batchId: string, error?: string): never => {
  revalidatePath(`/contactos/campanas/${batchId}`);
  redirect(`/contactos/campanas/${batchId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
};

export async function confirmBatchAction(formData: FormData) {
  const session = await adminOrRedirect();
  const batchId = batchIdOf(formData);
  const res = await freezeAndConfirm(session.organizationId, session.user.id, batchId, Number(text(formData, "typed", 10)));
  if (res.ok) await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: session.organizationId, action: "campaign.confirm", target: `campaign:${batchId}` });
  goBatch(batchId, res.ok ? undefined : res.error);
}

// Programar o iniciar: solo un lote CONFIRMADO, y solo si el envío real está habilitado en el servidor.
export async function startBatchAction(formData: FormData) {
  const session = await adminOrRedirect();
  const batchId = batchIdOf(formData);
  if (!sendingEnabled()) goBatch(batchId, "El envío de campañas está deshabilitado en el servidor (CAMPAIGNS_SEND_ENABLED).");
  const when = text(formData, "when", 30);
  const at = when ? wallTimeToDate(when) : null;
  if (when && !at) goBatch(batchId, "La fecha de programación no es válida.");
  if (at && at.getTime() < Date.now() - 60_000) goBatch(batchId, "La fecha de programación ya pasó.");
  const res = await startBatch(session.organizationId, batchId, at);
  if (res.ok) {
    await writeAudit({
      actorUserId: session.user.id,
      actingAsOrganizationId: session.organizationId,
      action: res.scheduled ? "campaign.schedule" : "campaign.start",
      target: `campaign:${batchId}`,
      metadata: at ? { at: at.toISOString() } : {},
    });
  }
  goBatch(batchId, res.ok ? undefined : res.error);
}

export async function pauseBatchAction(formData: FormData) {
  const session = await adminOrRedirect();
  const batchId = batchIdOf(formData);
  await pauseBatch(session.organizationId, batchId);
  await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: session.organizationId, action: "campaign.pause", target: `campaign:${batchId}` });
  goBatch(batchId);
}

export async function resumeBatchAction(formData: FormData) {
  const session = await adminOrRedirect();
  const batchId = batchIdOf(formData);
  if (!sendingEnabled()) goBatch(batchId, "El envío de campañas está deshabilitado en el servidor (CAMPAIGNS_SEND_ENABLED).");
  const res = await resumeBatch(session.organizationId, batchId);
  if (res.ok) await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: session.organizationId, action: "campaign.resume", target: `campaign:${batchId}` });
  goBatch(batchId, res.ok ? undefined : res.error);
}

export async function cancelBatchAction(formData: FormData) {
  const session = await adminOrRedirect();
  const batchId = batchIdOf(formData);
  await cancelBatch(session.organizationId, batchId);
  await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: session.organizationId, action: "campaign.cancel", target: `campaign:${batchId}` });
  goBatch(batchId);
}
