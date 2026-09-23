// Prueba de punta a punta del webhook contra la app corriendo y la base real.
// Crea sus propios datos con prefijo e2e- y los borra al final.
// Uso: (con `npm run dev` levantado) BASE_URL=http://localhost:3000 npm run test:e2e
import { config } from "dotenv";
config({ path: ".env.local" });

import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { channelAccounts, contactIdentities, contacts, conversations, messages, webhookEvents } from "../src/db/schema";
import type { WebhookMessageReceived, WebhookMessageStatus } from "../src/lib/zernio/types";
import { getConversation, listConversations, listMessages } from "../src/lib/inbox/queries";
import { deliverMessage } from "../src/lib/inbox/deliver";
import { runAgentForConversation } from "../src/lib/agent/run";
import { getReport, listActivity, listContacts } from "../src/lib/crm/queries";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.ZERNIO_WEBHOOK_SECRET!;
const run = `e2e-${Date.now()}`;
const ACCOUNT = `${run}-acc`;
const CONV = `${run}-conv`;
const WAMID = `${run}-wamid`;
const BSUID = `${run}-bsuid`;

async function post(path: string, payload: object) {
  const body = JSON.stringify(payload);
  const sig = createHmac("sha256", SECRET).update(body).digest("hex");
  const res = await fetch(BASE_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Zernio-Signature": sig },
    body,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const account = { id: ACCOUNT, accountId: ACCOUNT, platform: "whatsapp", username: "kore" };
const conversation = {
  id: `${run}-zernio-internal`,
  platformConversationId: CONV,
  participantId: BSUID,
  participantName: "Cliente E2E",
  status: "active" as const,
};

const received: WebhookMessageReceived = {
  id: randomUUID(),
  event: "message.received",
  timestamp: new Date().toISOString(),
  account,
  conversation,
  message: {
    id: `${run}-internal-msg`,
    conversationId: conversation.id,
    platform: "whatsapp",
    platformMessageId: WAMID,
    direction: "incoming",
    text: "Hola, quiero info de la propiedad",
    attachments: [],
    sender: { id: "5493410000000", businessScopedUserId: BSUID, phoneNumber: "+5493410000000", name: "Cliente E2E" },
    sentAt: new Date().toISOString(),
    isRead: false,
    sentVia: null,
  },
  metadata: { referral: { source_id: "ad-123", source_type: "ad", headline: "Depto en Rosario" } },
};

const status = (event: WebhookMessageStatus["event"]): WebhookMessageStatus => ({
  id: randomUUID(),
  event,
  timestamp: new Date().toISOString(),
  statusAt: new Date().toISOString(),
  account,
  conversation,
  message: {
    id: `${run}-internal-msg`,
    conversationId: conversation.id,
    platform: "whatsapp",
    platformMessageId: WAMID,
    direction: "outgoing",
    text: null,
    attachments: [],
    sender: { id: ACCOUNT },
    sentAt: new Date().toISOString(),
    isRead: false,
  },
});

async function cleanup() {
  const db = getDb();
  const ids = await db.select({ id: contactIdentities.contactId }).from(contactIdentities).where(like(contactIdentities.externalId, `${run}%`));
  await db.delete(conversations).where(eq(conversations.externalId, CONV));
  if (ids.length) await db.delete(contacts).where(inArray(contacts.id, ids.map((i) => i.id)));
  await db.delete(channelAccounts).where(eq(channelAccounts.externalId, ACCOUNT));
  await db.delete(webhookEvents).where(sql`${webhookEvents.payload}::text like ${"%" + run + "%"}`);
}

async function main() {
  const db = getDb();
  await db.insert(channelAccounts).values({ provider: "zernio", channel: "whatsapp", externalId: ACCOUNT, name: "E2E" });

  try {
    const first = await post("/webhooks/zernio/", received);
    assert.equal(first.status, 200, `primer envío: ${JSON.stringify(first.json)}`);
    assert.equal(first.json.result, "message");

    const retry = await post("/webhooks/zernio/", received);
    assert.equal(retry.status, 200);
    assert.equal(retry.json.duplicate, true, "el reintento debe cortarse como duplicado");

    // Mismo mensaje con otro id de evento (p. ej. otra suscripción): tampoco duplica.
    const sameMsgOtherEvent = await post("/api/webhooks/zernio", { ...received, id: randomUUID() });
    assert.equal(sameMsgOtherEvent.status, 200);

    const [conv] = await db.select().from(conversations).where(eq(conversations.externalId, CONV));
    const msgs = await db.select().from(messages).where(eq(messages.externalId, WAMID));
    const idents = await db.select().from(contactIdentities).where(like(contactIdentities.externalId, `%${run}%`));
    const phoneIdent = await db.select().from(contactIdentities).where(eq(contactIdentities.externalId, "5493410000000"));

    assert.equal(msgs.length, 1, "un solo mensaje");
    assert.equal(conv.unreadCount, 1, "no leídos no se suma dos veces");
    assert.ok(conv.lastInboundAt, "last_inbound_at seteado");
    assert.equal(conv.channel, "whatsapp");
    assert.equal(conv.provider, "zernio");
    assert.ok(conv.contactId, "conversación ligada a contacto");
    assert.equal((conv.metadata as { zernioConversationId?: string }).zernioConversationId, conversation.id);
    assert.equal((conv.metadata as { attribution?: { source_id?: string } }).attribution?.source_id, "ad-123", "atribución guardada");
    assert.equal(idents.length, 1, "identidad BSUID");
    assert.equal(phoneIdent.length, 1, "identidad por sender.id");
    assert.equal(idents[0].contactId, phoneIdent[0].contactId, "ambas identidades, mismo contacto");

    // ---- Bandeja (Fase 4) ----
    const listed = await listConversations({ q: "Cliente E2E" });
    const row = listed.find((c) => c.id === conv.id);
    assert.ok(row, "búsqueda por nombre encuentra la conversación");
    assert.equal(row.unreadCount, 1);
    assert.equal(row.preview, "Hola, quiero info de la propiedad", "vista previa del último mensaje");
    assert.equal(row.phone, "+5493410000000", "WhatsApp muestra teléfono");
    assert.equal((await listConversations({ channel: "instagram", q: "Cliente E2E" })).length, 0, "filtro por canal");
    const detail = await getConversation(conv.id);
    assert.equal(detail?.window.state, "open", "ventana abierta tras un entrante");
    assert.equal((await listMessages(conv.id)).length, 1);

    // ---- Agente (Fase 5): interruptores, sin llamar a OpenAI ----
    process.env.OPENAI_API_KEY = "";
    const trigger = msgs[0].id;
    assert.deepEqual(await runAgentForConversation(conv.id, { triggerMessageId: trigger }), { status: "skipped", reason: "openai_key_missing" }, "pasa los dos interruptores y la ventana");
    await db.update(conversations).set({ aiEnabled: false }).where(eq(conversations.id, conv.id));
    assert.deepEqual(await runAgentForConversation(conv.id, { triggerMessageId: trigger }), { status: "skipped", reason: "conversation_ai_off" });
    await db.update(conversations).set({ aiEnabled: true }).where(eq(conversations.id, conv.id));

    // ---- deliverMessage: Zernio rechaza la cuenta falsa -> fila persistida como failed ----
    const failed = await deliverMessage(conv.id, { text: "Prueba e2e", source: "human" });
    assert.equal(failed.ok, false);
    assert.equal(!failed.ok && failed.code, "send_failed", "un envío rechazado no se pierde en silencio");
    const [failedRow] = await db.select().from(messages).where(eq(messages.id, (!failed.ok && failed.message?.id) || ""));
    assert.equal(failedRow?.status, "failed");
    assert.equal(failedRow?.direction, "outbound");
    assert.deepEqual(await runAgentForConversation(conv.id, { triggerMessageId: trigger }), { status: "skipped", reason: "superseded" }, "después de una respuesta, el agente no contesta");

    // ---- Ventana cerrada: WhatsApp fuera de 24 h no deja enviar texto ----
    await db.update(conversations).set({ lastInboundAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(conversations.id, conv.id));
    const closed = await deliverMessage(conv.id, { text: "no debería salir", source: "human" });
    assert.equal(!closed.ok && closed.code, "window_closed");
    assert.equal((await getConversation(conv.id))?.window.state, "template_only");
    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, conv.id))).length, 2, "la ventana cerrada no inserta nada");

    const read = await post("/api/webhooks/zernio", status("message.read"));
    const lateDelivered = await post("/api/webhooks/zernio", status("message.delivered"));
    assert.equal(read.status, 200);
    assert.equal(lateDelivered.status, 200);
    const [afterStatus] = await db.select({ status: messages.status }).from(messages).where(eq(messages.externalId, WAMID));
    assert.equal(afterStatus.status, "read", "un delivered tardío no pisa read");

    const unknown = await post("/api/webhooks/zernio", { id: randomUUID(), event: "algo.nuevo", timestamp: new Date().toISOString(), note: run });
    assert.equal(unknown.status, 200, "evento desconocido: 200, nunca 500");

    // ---- Contactos, Actividades, Reportes ----
    const people = await listContacts({ q: "Cliente E2E" });
    assert.equal(people.length, 1, "un contacto aunque tenga dos identidades");
    assert.deepEqual(people[0].handles.map((h) => h.channel), ["whatsapp"], "un badge por canal");
    assert.deepEqual(people[0].conversations.map((c) => c.id), [conv.id], "link a su conversación");
    assert.equal((await listContacts({ q: "Cliente E2E", channel: "facebook" })).length, 0, "filtro por canal");
    const feed = (await listActivity(500)).filter((a) => a.conversationId === conv.id);
    assert.deepEqual(feed.map((a) => a.kind).sort(), ["failed", "new_conversation"], "actividad: conversación nueva + envío fallido");
    const report = await getReport(7);
    assert.ok(report.inbound >= 1 && report.newConversations >= 1 && report.failed >= 1, "reporte cuenta los datos de prueba");
    assert.equal(report.daily.length, 7);
    assert.ok(report.daily.at(-1)!.inbound >= 1, "el día de hoy tiene el mensaje");

    console.log("webhook e2e: OK");
  } finally {
    await cleanup();
  }
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  await cleanup().catch(() => {});
  process.exit(1);
});
