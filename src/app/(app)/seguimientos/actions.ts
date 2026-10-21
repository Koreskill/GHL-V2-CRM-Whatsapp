"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { writeAudit } from "@/lib/agency/queries";
import { cleanIds } from "@/lib/crm/groups";
import { deleteSequence, saveSequence, setSequenceEnabled } from "@/lib/followups/queries";

// Seguimientos: SOLO administradores, validado en el servidor en cada acción.

const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);
const int = (form: FormData, key: string, fallback: number) => {
  const n = Number(text(form, key, 10));
  return Number.isInteger(n) ? n : fallback;
};

async function admin() {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  return session;
}

export async function saveSequenceAction(formData: FormData) {
  const session = await admin();
  const id = text(formData, "id", 64);
  // Pasos: hasta 10 filas; una fila sin texto se ignora. La espera se carga en minutos u horas.
  const steps: { delayMinutes: number; body: string }[] = [];
  for (let i = 0; i < 10; i++) {
    const body = text(formData, `body${i}`, 1000);
    if (!body) continue;
    const amount = Number(text(formData, `delay${i}`, 6).replace(",", "."));
    const unit = text(formData, `unit${i}`, 3) === "h" ? 60 : 1;
    steps.push({ delayMinutes: Math.round((Number.isFinite(amount) ? amount : 0) * unit), body });
  }
  const accountId = text(formData, "account", 64);
  const res = await saveSequence(session.organizationId, session.user.id, {
    id: isUuid(id) ? id : undefined,
    name: text(formData, "name", 80),
    channelAccountId: isUuid(accountId) ? accountId : null,
    audience: { groupIds: cleanIds(formData.getAll("g")), labelIds: cleanIds(formData.getAll("l")), segmentIds: cleanIds(formData.getAll("s")) },
    timezone: text(formData, "timezone", 60) || "America/Argentina/Buenos_Aires",
    allowedStartHour: int(formData, "start", 8),
    allowedEndHour: int(formData, "end", 22),
    maxPerDay: int(formData, "maxPerDay", 5),
    minGapMinutes: int(formData, "minGap", 60),
    windowMarginMinutes: int(formData, "margin", 15),
    stopOnHandoff: formData.get("stopOnHandoff") === "on",
    stopOnDealClosed: formData.get("stopOnDealClosed") === "on",
    steps,
  });
  if (!res.ok) redirect(`/seguimientos/${isUuid(id) ? id : "nueva"}?error=${encodeURIComponent(res.error)}`);
  await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: session.organizationId, action: "followup.save", target: `followup:${res.id}` });
  revalidatePath("/seguimientos");
  redirect(`/seguimientos/${res.id}?ok=guardada`);
}

export async function toggleSequenceAction(formData: FormData) {
  const session = await admin();
  const id = text(formData, "id", 64);
  if (!isUuid(id)) redirect("/seguimientos");
  const enabled = formData.get("enabled") === "1";
  await setSequenceEnabled(session.organizationId, id, enabled);
  await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: session.organizationId, action: enabled ? "followup.enable" : "followup.disable", target: `followup:${id}` });
  revalidatePath("/seguimientos");
  redirect(`/seguimientos/${id}`);
}

export async function deleteSequenceAction(formData: FormData) {
  const session = await admin();
  const id = text(formData, "id", 64);
  if (isUuid(id)) {
    await deleteSequence(session.organizationId, id);
    await writeAudit({ actorUserId: session.user.id, actingAsOrganizationId: session.organizationId, action: "followup.delete", target: `followup:${id}` });
  }
  revalidatePath("/seguimientos");
  redirect("/seguimientos");
}
