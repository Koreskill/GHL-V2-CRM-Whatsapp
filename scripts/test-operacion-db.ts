// Pruebas CON base de la operación. Todo corre dentro de runInSandbox: una transacción que SIEMPRE se
// revierte, así que no deja filas. Igual: NO correr contra producción (usar staging, ver CLAUDE.md).
//
// Cubre los criterios de aceptación del encargo:
//  1. Un evento duplicado no genera dos respuestas (un solo trabajo de triaje).
//  2. Los datos de una cuenta no aparecen en otra (etiquetas, grupos, audiencias, ids ajenos).
//  3. Grupos y segmentos seleccionan los destinatarios correctos.
//  4. Una campaña pausada no toma destinatarios nuevos.
//  5. Reintentar un envío con clave no duplica el mensaje.
//  6. Una respuesta del usuario corta el seguimiento.
//  8. Una inmobiliaria suspendida no envía nada automático.
// 10. Un trabajo con el lease vencido (proceso caído) se retoma.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });
// Encendido para probar los otros cortes (pausa, suspensión). Ningún caso de esta prueba llega a enviar.
process.env.CAMPAIGNS_SEND_ENABLED = "true";

import { getDb, runInSandbox } from "../src/db";
import {
  campaignBatches,
  campaignRecipients,
  channelAccounts,
  contactIdentities,
  contacts,
  conversations,
  followupEnrollments,
  followupSequences,
  jobs,
  messages,
  organizations,
} from "../src/db/schema";
import { forgetOrgStatus } from "../src/lib/agency/lifecycle";
import { loadAudience } from "../src/lib/campaigns/batches";
import { runCampaignSlice } from "../src/lib/campaigns/run";
import { audienceWhere, contactIdsMatching, saveGroup, saveLabel, setGroupMembership, setLabel } from "../src/lib/crm/groups";
import { deliverMessage } from "../src/lib/inbox/deliver";
import { claimEvent, processEvent } from "../src/lib/inbox/webhook-events";
import { claimDue, enqueue } from "../src/lib/jobs/queue";

async function org(name: string) {
  const [o] = await getDb().insert(organizations).values({ name, slug: `${name}-${randomUUID().slice(0, 8)}` }).returning();
  return o;
}

async function waContact(orgId: string, accountId: string, accountExternal: string, name: string) {
  const db = getDb();
  const [c] = await db.insert(contacts).values({ organizationId: orgId, name }).returning();
  const ext = `549${Math.floor(Math.random() * 1e10)}`;
  await db.insert(contactIdentities).values({ organizationId: orgId, contactId: c.id, channel: "whatsapp", externalId: ext });
  const [cv] = await db
    .insert(conversations)
    .values({
      organizationId: orgId,
      contactId: c.id,
      channel: "whatsapp",
      provider: "zernio",
      externalId: `conv-${randomUUID()}`,
      accountId: accountExternal,
      channelAccountId: accountId,
      lastInboundAt: new Date(),
      lastMessageAt: new Date(),
    })
    .returning();
  return { contact: c, conversation: cv, externalId: ext };
}

async function main() {
  await runInSandbox(async () => {
    const db = getDb();
    const A = await org("op-test-a");
    const B = await org("op-test-b");
    const accExtA = `acc-${randomUUID()}`;
    const [accA] = await db.insert(channelAccounts).values({ organizationId: A.id, provider: "zernio", channel: "whatsapp", externalId: accExtA, status: "connected" }).returning();
    const [accB] = await db.insert(channelAccounts).values({ organizationId: B.id, provider: "zernio", channel: "whatsapp", externalId: `acc-${randomUUID()}`, status: "connected" }).returning();

    const a1 = await waContact(A.id, accA.id, accExtA, "Ana Uno");
    const a2 = await waContact(A.id, accA.id, accExtA, "Beto Dos");
    const a3 = await waContact(A.id, accA.id, accExtA, "Caro Tres");
    const b1 = await waContact(B.id, accB.id, accB.externalId, "Diego Otro");

    // ── 2. Aislamiento ──────────────────────────────────────────────────────
    const la = await saveLabel(A.id, { name: "Inversor", color: "blue" });
    assert.ok(la.ok);
    const [labelA] = await db.execute<{ id: string }>(sql`select id from contact_labels where organization_id = ${A.id} and name = 'Inversor'`);
    // B intenta usar la etiqueta de A sobre su propio contacto y sobre uno de A: nada.
    const cross = await setLabel(B.id, randomUUID(), labelA.id, [b1.contact.id, a1.contact.id], true);
    assert.equal(cross.ok, false, "una inmobiliaria no puede usar la etiqueta de otra");
    // A intenta etiquetar un contacto de B: se descarta en silencio.
    const mixed = await setLabel(A.id, randomUUID(), labelA.id, [a1.contact.id, b1.contact.id], true);
    assert.deepEqual(mixed, { ok: true, changed: 1 }, "un contacto ajeno se descarta");
    const whereB = await audienceWhere(B.id, { labelIds: [labelA.id] });
    const seenByB = await db.execute(sql`select c.id from contacts c where ${whereB}`);
    assert.equal(seenByB.length, 0, "la audiencia de B con la etiqueta de A está vacía");
    const idsB = await contactIdsMatching(B.id, {});
    assert.ok(!idsB.includes(a1.contact.id) && idsB.includes(b1.contact.id), "contactIdsMatching no cruza inmobiliarias");

    // ── 3. Grupos y segmentos ─────────────────────────────────────────────
    const g = await saveGroup(A.id, randomUUID(), { name: "Feria" });
    assert.ok(g.ok);
    const gid = (g as { id: string }).id;
    await setGroupMembership(A.id, randomUUID(), gid, [a1.contact.id, a2.contact.id], true);
    const byGroup = await loadAudience(A.id, { filters: {}, sources: { groupIds: [gid] }, channelAccountId: accA.id });
    assert.deepEqual(byGroup.map((r) => r.contactId).sort(), [a1.contact.id, a2.contact.id].sort(), "el grupo selecciona sus miembros");
    const byLabelOrGroup = await loadAudience(A.id, { filters: {}, sources: { groupIds: [gid], labelIds: [labelA.id] }, channelAccountId: accA.id });
    assert.equal(byLabelOrGroup.length, 2, "grupo y etiqueta se suman sin duplicar");
    const groupAndHot = await loadAudience(A.id, { filters: { temperature: "caliente" }, sources: { groupIds: [gid] }, channelAccountId: accA.id });
    assert.equal(groupAndHot.length, 0, "los filtros recortan la fuente");
    await db.update(contacts).set({ marketingOptOutAt: new Date() }).where(eq(contacts.id, a2.contact.id));
    const withOptOut = await loadAudience(A.id, { filters: {}, sources: { groupIds: [gid] }, channelAccountId: accA.id });
    assert.equal(withOptOut.find((r) => r.contactId === a2.contact.id)?.optedOut, true, "la baja queda marcada para excluirla");
    await db.update(contacts).set({ marketingOptOutAt: null }).where(eq(contacts.id, a2.contact.id));

    // ── 1. Evento duplicado: un solo trabajo de triaje ─────────────────────
    const eventId = `evt-${randomUUID()}`;
    const payload = {
      id: eventId,
      event: "message.received",
      timestamp: new Date().toISOString(),
      account: { id: accExtA, accountId: accExtA },
      conversation: { id: "zc", platformConversationId: a3.conversation.externalId, participantId: a3.externalId },
      message: {
        id: "zm",
        platformMessageId: `wamid.${randomUUID()}`,
        platform: "whatsapp",
        direction: "incoming",
        text: "Hola, ¿sigue disponible?",
        sentAt: new Date().toISOString(),
        attachments: [],
        sender: { id: a3.externalId, name: "Caro Tres" },
      },
    } as never;
    assert.equal(await claimEvent(db, { eventId, eventType: "message.received", payload }), true);
    assert.equal(await claimEvent(db, { eventId, eventType: "message.received", payload }), false, "el reintento del webhook no se reclama dos veces");
    const r1 = await processEvent(db, eventId, payload);
    const r2 = await processEvent(db, eventId, payload); // reprocesar (barrido) el mismo evento
    assert.ok(r1?.kind === "message" && r1.inserted, "el primer proceso inserta");
    assert.ok(r2?.kind === "message" && !r2.inserted, "reprocesar no vuelve a insertar");
    const triageJobs = await db.select().from(jobs).where(and(eq(jobs.organizationId, A.id), eq(jobs.kind, "triage")));
    assert.equal(triageJobs.length, 1, "un evento duplicado deja UN trabajo de triaje");

    // ── 6. Una respuesta corta el seguimiento ──────────────────────────────
    const [seq] = await db.insert(followupSequences).values({ organizationId: A.id, name: "test", enabled: true }).returning();
    const [enr] = await db
      .insert(followupEnrollments)
      .values({ organizationId: A.id, sequenceId: seq.id, conversationId: a1.conversation.id, contactId: a1.contact.id, anchorAt: new Date(Date.now() - 3600_000), nextRunAt: new Date() })
      .returning();
    const evt2 = `evt-${randomUUID()}`;
    const reply = {
      ...(payload as object),
      id: evt2,
      conversation: { id: "zc2", platformConversationId: a1.conversation.externalId, participantId: a1.externalId },
      message: { ...((payload as { message: object }).message), platformMessageId: `wamid.${randomUUID()}`, sender: { id: a1.externalId } },
    } as never;
    await claimEvent(db, { eventId: evt2, eventType: "message.received", payload: reply });
    await processEvent(db, evt2, reply);
    const [after] = await db.select().from(followupEnrollments).where(eq(followupEnrollments.id, enr.id));
    assert.equal(after.status, "respondio", "el mensaje del contacto corta el seguimiento");

    // ── 5. Reintento con clave: no duplica ─────────────────────────────────
    const key = `campaign:${randomUUID()}`;
    const [prev] = await db
      .insert(messages)
      .values({
        organizationId: A.id,
        conversationId: a2.conversation.id,
        channel: "whatsapp",
        provider: "zernio",
        direction: "outbound",
        type: "text",
        body: "ya salió",
        status: "sent",
        externalId: `wamid.${randomUUID()}`,
        rawPayload: { source: "followup", idempotencyKey: key },
      })
      .returning();
    const before = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, a2.conversation.id));
    const again = await deliverMessage(a2.conversation.id, { text: "ya salió", source: "followup", organizationId: A.id, idempotencyKey: key });
    assert.ok(again.ok && again.message.id === prev.id, "el reintento devuelve el mensaje que ya salió");
    const afterRetry = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, a2.conversation.id));
    assert.equal(afterRetry.length, before.length, "el reintento no inserta otro mensaje");
    // Y la conversación de otra inmobiliaria no se puede usar aunque se conozca su id.
    const foreign = await deliverMessage(b1.conversation.id, { text: "x", source: "human", organizationId: A.id });
    assert.equal(foreign.ok, false, "no se envía por la conversación de otra inmobiliaria");

    // ── 4. Campaña pausada: no toma destinatarios ──────────────────────────
    const [batch] = await db
      .insert(campaignBatches)
      .values({ organizationId: A.id, createdBy: randomUUID(), name: "c", templateName: "t", templateLanguage: "es", status: "pausada", channelAccountId: accA.id, audienceCount: 1 })
      .returning();
    await db.insert(campaignRecipients).values({ organizationId: A.id, batchId: batch.id, contactId: a1.contact.id, conversationId: a1.conversation.id });
    const slice = await runCampaignSlice(A.id, batch.id);
    assert.equal(slice.next, null);
    const [rec] = await db.select().from(campaignRecipients).where(eq(campaignRecipients.batchId, batch.id));
    assert.equal(rec.status, "pendiente", "una campaña pausada no incorpora envíos");
    assert.equal(rec.attempts, 0);

    // ── 8. Suspendida: nada automático ─────────────────────────────────────
    await db.update(organizations).set({ status: "suspendida" }).where(eq(organizations.id, A.id));
    forgetOrgStatus(A.id);
    const blocked = await deliverMessage(a3.conversation.id, { text: "hola", source: "followup", organizationId: A.id });
    assert.equal(!blocked.ok && blocked.code, "org_inactive", "una inmobiliaria suspendida no envía seguimientos");
    const blockedCampaign = await deliverMessage(a3.conversation.id, { template: { name: "t", language: "es", params: [] }, source: "campaign", organizationId: A.id });
    assert.equal(!blockedCampaign.ok && blockedCampaign.code, "org_inactive", "ni campañas");
    await db.update(campaignBatches).set({ status: "enviando" }).where(eq(campaignBatches.id, batch.id));
    const suspendedSlice = await runCampaignSlice(A.id, batch.id);
    assert.equal(suspendedSlice.summary.stopped, "la inmobiliaria no está activa", "la campaña se pausa sola si la inmobiliaria se suspende");
    await db.update(organizations).set({ status: "activa" }).where(eq(organizations.id, A.id));
    forgetOrgStatus(A.id);

    // ── 10. Lease vencido: el trabajo se retoma ────────────────────────────
    const dk = `test:${randomUUID()}`;
    await enqueue({ organizationId: A.id, kind: "account_import", dedupeKey: dk, payload: {} });
    await enqueue({ organizationId: A.id, kind: "account_import", dedupeKey: dk, payload: {} });
    const sameKey = await db.select().from(jobs).where(eq(jobs.dedupeKey, dk));
    assert.equal(sameKey.length, 1, "encolar dos veces lo mismo deja un trabajo");
    await db.update(jobs).set({ status: "running", leaseUntil: new Date(Date.now() - 60_000), attempts: 1 }).where(eq(jobs.dedupeKey, dk));
    const retaken = await claimDue(["account_import"], 50);
    assert.ok(retaken.some((j) => j.dedupeKey === dk), "un trabajo con el lease vencido (proceso caído) se retoma");
    const again2 = await claimDue(["account_import"], 50);
    assert.ok(!again2.some((j) => j.dedupeKey === dk), "uno reclamado no se reclama dos veces");
  });
  console.log("operacion-db: OK (sandbox revertido)");
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
