import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { channelAccounts, messages } from "@/db/schema";
import { canAutomate, forgetOrgStatus, ingestAllowed, orgStatus } from "@/lib/agency/lifecycle";
import { isOptOutRequest, OPT_OUT_ACK } from "@/lib/crm/opt-out";
import type { Job } from "./queue";
import type { HandlerResult } from "./worker";

// Un trabajo que tira una excepción se reintenta (con espera). Uno que devuelve "done" o "skip" termina.
// Por eso acá solo se deja escapar lo transitorio (base caída, red); lo que ya quedó registrado no se repite.

export async function handleTriage(job: Job): Promise<HandlerResult> {
  const conversationId = String(job.payload.conversationId ?? "");
  const messageId = String(job.payload.messageId ?? "");
  if (!conversationId || !messageId || !job.organizationId) return { outcome: "skip", reason: "payload incompleto" };
  if (!(await canAutomate(job.organizationId))) return { outcome: "skip", reason: "org_inactive" };

  // Una baja no se le pasa al modelo: se confirma con un texto fijo y no se gasta un token.
  const [msg] = await getDb()
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, job.organizationId)));
  if (msg && isOptOutRequest(msg.body)) {
    const { deliverMessage } = await import("@/lib/inbox/deliver");
    const res = await deliverMessage(conversationId, {
      text: OPT_OUT_ACK,
      source: "agent",
      organizationId: job.organizationId,
      idempotencyKey: `optout:${messageId}`,
    });
    return { outcome: "done", result: { optOut: true, acked: res.ok } };
  }

  const { triageIncomingMessage } = await import("@/lib/agent/triage/run");
  const outcome = await triageIncomingMessage(conversationId, { triggerMessageId: messageId });
  // Sin el texto del mensaje ni lo que escribió el modelo: solo el resultado.
  return { outcome: "done", result: { status: outcome.status, ...("reason" in outcome ? { reason: outcome.reason } : {}) } };
}

export async function handleCampaign(job: Job): Promise<HandlerResult> {
  const batchId = String(job.payload.batchId ?? "");
  if (!batchId || !job.organizationId) return { outcome: "skip", reason: "payload incompleto" };
  const { runCampaignSlice } = await import("@/lib/campaigns/run");
  const r = await runCampaignSlice(job.organizationId, batchId);
  if (r.next) return { outcome: "later", runAfter: r.next, result: r.summary };
  return { outcome: "done", result: r.summary };
}

export async function handleAccountImport(job: Job): Promise<HandlerResult> {
  const accountId = String(job.payload.channelAccountId ?? "");
  if (!accountId || !job.organizationId) return { outcome: "skip", reason: "payload incompleto" };
  const db = getDb();
  const [account] = await db
    .select()
    .from(channelAccounts)
    .where(and(eq(channelAccounts.id, accountId), eq(channelAccounts.organizationId, job.organizationId)));
  if (!account) return { outcome: "skip", reason: "cuenta inexistente" };
  if (account.historyImportedAt) return { outcome: "skip", reason: "ya importada" };
  const { importAccountHistory } = await import("@/lib/inbox/import");
  const r = await importAccountHistory(db, account);
  return { outcome: "done", result: { conversations: r.conversations, messages: r.messages } };
}

// Copia los adjuntos de un mensaje a Storage apenas llega: Meta los descarta después de un plazo (ver media-store.ts).
// Corre para todo mensaje con adjuntos, con o sin bot y aunque la inmobiliaria esté suspendida: es conservar datos.
export async function handleMediaStore(job: Job): Promise<HandlerResult> {
  const messageId = String(job.payload.messageId ?? "");
  if (!messageId || !job.organizationId) return { outcome: "skip", reason: "payload incompleto" };
  const orgId = job.organizationId;
  // Eliminada = anonimizada: no se vuelve a subir nada. Sin caché: la anonimización puede estar corriendo ahora.
  const orgAlive = async () => {
    forgetOrgStatus(orgId);
    return ingestAllowed(await orgStatus(orgId));
  };
  if (!(await orgAlive())) return { outcome: "skip", reason: "org_eliminada" };
  const { hasAdminKey } = await import("@/lib/supabase/admin");
  if (!hasAdminKey()) {
    // Sin clave de servicio no hay Storage: que se vea, agrupado en un solo incidente de agencia.
    const { reportIncident } = await import("@/lib/incidents/report");
    await reportIncident({
      organizationId: null,
      module: "mensajeria",
      key: "medios-sin-storage",
      message: "Los adjuntos no se están guardando: falta SUPABASE_SECRET_KEY. Meta los borra después de un tiempo.",
    });
    return { outcome: "skip", reason: "sin SUPABASE_SECRET_KEY" };
  }
  const [msg] = await getDb()
    .select({ rawPayload: messages.rawPayload })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, job.organizationId)));
  if (!msg) return { outcome: "skip", reason: "mensaje inexistente" };

  const [{ attachmentsFromPayload, isStorable }, { fetchMedia, MAX_SERVE_BYTES }, { storeMedia }] = await Promise.all([
    import("@/lib/inbox/media"),
    import("@/lib/ai/media"),
    import("@/lib/inbox/media-store"),
  ]);
  let stored = 0;
  const lost: string[] = [];
  for (const a of attachmentsFromPayload(msg.rawPayload).filter(isStorable)) {
    const file = await fetchMedia(a.url, { maxBytes: MAX_SERVE_BYTES });
    if (!file.ok) {
      // 400/404/410 (Meta ya lo descartó o no existe), demasiado grande o URL inválida no se arreglan reintentando.
      // Un 401 (clave mal configurada) o un 429 sí: reintentan y, si se agotan, quedan como incidente.
      if (/^HTTP (400|404|410)\b|demasiado grande|no válida|no permitido/i.test(file.error)) {
        lost.push(`${a.index}: ${file.error}`);
        continue;
      }
      throw new Error(`No se pudo descargar el adjunto ${a.index}: ${file.error}`);
    }
    if (!(await orgAlive())) return { outcome: "skip", reason: "org_eliminada" };
    await storeMedia(orgId, messageId, a.index, file);
    stored++;
  }
  return { outcome: "done", result: { stored, ...(lost.length ? { lost } : {}) } };
}
