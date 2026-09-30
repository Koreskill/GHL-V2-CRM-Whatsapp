"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isUuid } from "@/lib/api";
import { authorizeAction } from "@/lib/deals/guard";
import { cancelDelegation, createDelegation, rejectDelegation, takeDelegation } from "@/lib/delegations/flow";
import { isConversationStatus, setConversationStatus } from "@/lib/inbox/status";

const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);

function idOf(form: FormData, key = "conversationId") {
  const id = text(form, key, 64);
  if (!isUuid(id)) redirect("/conversaciones");
  return id;
}

// Activar, desactivar, archivar o restaurar. La organización sale de la sesión.
export async function changeConversationStatus(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const conversationId = idOf(formData);
  const status = text(formData, "status", 16);
  if (!isConversationStatus(status)) redirect("/conversaciones");
  await setConversationStatus(orgId, conversationId, status, session.user.id);
  revalidatePath("/conversaciones");
  // Al archivar se vuelve a la lista; en los demás casos se queda en el hilo.
  redirect(status === "archivada" ? "/conversaciones" : `/conversaciones/${conversationId}?tab=${status === "desactiva" ? "desactivas" : "activas"}`);
}

export async function delegateConversationAction(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const conversationId = idOf(formData);
  const res = await createDelegation({
    orgId,
    userId: session.user.id,
    conversationId,
    note: text(formData, "note", 500) || null,
    scope: { history: formData.get("history") === "on", phone: formData.get("phone") === "on" },
  });
  revalidatePath("/conversaciones");
  redirect(`/conversaciones/${conversationId}?${res.ok ? "delegada=1" : `error=${encodeURIComponent(res.error)}`}`);
}

export async function takeDelegationAction(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  const res = await takeDelegation({ orgId, userId: session.user.id, delegationId: idOf(formData, "delegationId") });
  revalidatePath("/conversaciones");
  if (!res.ok) redirect(`/conversaciones?tab=delegadas&error=${encodeURIComponent(res.error)}`);
  // Aparece en Activas de la receptora, ya abierta.
  redirect(`/conversaciones/${res.conversationId}`);
}

export async function cancelDelegationAction(formData: FormData) {
  const { session, orgId } = await authorizeAction();
  await cancelDelegation(orgId, session.user.id, idOf(formData, "delegationId"));
  revalidatePath("/conversaciones");
  redirect("/conversaciones?tab=delegadas");
}

export async function rejectDelegationAction(formData: FormData) {
  const { orgId } = await authorizeAction();
  await rejectDelegation(orgId, idOf(formData, "delegationId"));
  revalidatePath("/conversaciones");
  redirect("/conversaciones?tab=delegadas");
}
