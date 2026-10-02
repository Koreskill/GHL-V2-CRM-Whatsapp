import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { applyTags, type TagDecisions } from "../src/lib/agent/triage/tags";
import { setConversationStatus } from "../src/lib/inbox/status";
import { getRecommendations, recomputeScores, saveManualPreferences } from "../src/lib/scoring/store";

// Puntaje de compatibilidad contra la base REAL (rol crm_app). Requiere la migración 0017.
// Todo corre dentro de una transacción que se revierte: no queda ninguna fila.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("scoring_test_rollback");

const noDecisions: TagDecisions = { operation: null, propertyType: null, urgency: null, paymentMethod: null, temperature: null, interestedInShownProperty: 0 };

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-puntaje-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;
        const [org, otra] = await tx.insert(schema.organizations).values([{ name: "Prueba Puntaje", slug: `${slug}-a` }, { name: "Prueba Ajena", slug: `${slug}-b` }]).returning();

        const prop = (organizationId: string, title: string, extra: Partial<typeof schema.properties.$inferInsert> = {}) =>
          tx
            .insert(schema.properties)
            .values({ organizationId, operation: "venta", propertyType: "casa", status: "disponible", title, zone: "Funes", city: "Funes", price: "240000", currency: "USD", bedrooms: 3, bathrooms: 2, amenities: ["pileta"], ...extra })
            .returning()
            .then((r) => r[0]);
        const conPileta = await prop(org.id, "Casa con pileta");
        const sinPileta = await prop(org.id, "Casa sin pileta", { amenities: ["jardin"] });
        const lejos = await prop(org.id, "Casa en Rosario", { zone: "Rosario", city: "Rosario" });
        const vendida = await prop(org.id, "Casa vendida", { status: "vendida" });
        const ajena = await prop(otra.id, "Casa de otro cliente");

        const lead = async (name: string) => {
          const [contact] = await tx.insert(schema.contacts).values({ organizationId: org.id, name }).returning();
          const [conv] = await tx
            .insert(schema.conversations)
            .values({ organizationId: org.id, contactId: contact.id, channel: "whatsapp", provider: "zernio", externalId: `x-${randomUUID()}`, accountId: "acc", participantName: name })
            .returning();
          const [msg] = await tx
            .insert(schema.messages)
            .values({ organizationId: org.id, conversationId: conv.id, channel: "whatsapp", provider: "zernio", direction: "inbound", body: "hola", status: "received" })
            .returning();
          return { contact, conv, msg };
        };
        const A = await lead("Lead A");
        const B = await lead("Lead B");
        const ids = async (convId: string) => (await getRecommendations(org.id, convId, "https://crm.test")).cartera.map((r) => r.id);

        // Sin nada que comparar no hay recomendaciones.
        assert.deepEqual((await getRecommendations(org.id, A.conv.id, "https://crm.test")).cartera, []);

        // 14. Llega información en un mensaje: se actualiza el perfil con su procedencia y se calculan los puntajes.
        const t1 = await applyTags({
          organizationId: org.id, contactId: A.contact.id, conversationId: A.conv.id, messageId: A.msg.id,
          decisions: { ...noDecisions, operation: "venta", propertyType: "casa" },
          extracted: { zonas: ["Funes"], presupuesto_max: 250000, dormitorios: 3, estrictos: ["dormitorios"], confianza: 0.9 },
        });
        assert.ok(t1.changedCriteria.includes("zones") && t1.changedCriteria.includes("budgetMax"));
        const [req] = await tx.select().from(schema.prospectRequirements).where(eq(schema.prospectRequirements.id, t1.requirementId));
        const crit = req.criteria as Record<string, { source: string; messageId: string | null; strict: boolean | null }>;
        assert.equal(crit.bedroomsMin.strict, true, "queda marcado como indispensable");
        assert.equal(crit.zones.messageId, A.msg.id, "queda de qué mensaje salió");
        assert.equal(crit.zones.source, "ai");

        await recomputeScores(org.id, A.conv.id, { changedCriteria: t1.changedCriteria, triggeringMessageId: A.msg.id });
        const rec1 = await getRecommendations(org.id, A.conv.id, "https://crm.test");
        const got = new Set(rec1.cartera.map((r) => r.id));
        assert.ok(got.has(conPileta.id) && got.has(sinPileta.id), "las de la cartera que encajan aparecen");
        assert.ok(!got.has(vendida.id), "una vendida no se ofrece");
        assert.ok(!got.has(ajena.id), "17. el inventario de otro cliente nunca se puntúa");
        assert.ok(!(await tx.select().from(schema.leadPropertyScores).where(eq(schema.leadPropertyScores.propertyId, ajena.id))).length);
        const [lejosRow] = rec1.cartera.filter((r) => r.id === lejos.id);
        assert.ok(!lejosRow || lejosRow.score < rec1.cartera[0].score, "otra zona puntúa menos");
        const antes = rec1.cartera.find((r) => r.id === sinPileta.id)!.score;

        // Todo lo que se muestra tiene explicación (la que sale del mismo cálculo).
        for (const r of rec1.cartera) assert.ok(r.matched.length + r.conflicting.length + r.missing.length > 0, "nunca un número sin explicación");

        // 15 y "ranking en vivo": "Para mí la pileta es indispensable" cambia el orden sin tocar la conversación.
        const t2 = await applyTags({
          organizationId: org.id, contactId: A.contact.id, conversationId: A.conv.id, messageId: A.msg.id,
          decisions: noDecisions, extracted: { amenities_requeridos: ["pileta"], confianza: 0.95 },
        });
        assert.deepEqual(t2.changedCriteria, ["requiredAmenities"]);
        await recomputeScores(org.id, A.conv.id, { changedCriteria: t2.changedCriteria, triggeringMessageId: A.msg.id });
        const rec2 = await getRecommendations(org.id, A.conv.id, "https://crm.test");
        assert.equal(rec2.cartera[0].id, conPileta.id, "la que tiene pileta pasa primero");
        const despues = rec2.cartera.find((r) => r.id === sinPileta.id)!.score;
        assert.ok(despues < antes, `la que no tiene pileta baja (${antes} → ${despues})`);
        const hist = await tx.select().from(schema.leadPropertyScoreHistory).where(eq(schema.leadPropertyScoreHistory.conversationId, A.conv.id));
        assert.ok(hist.some((h) => h.targetId === sinPileta.id && h.previousScore === antes && h.newScore === despues), "queda el historial de lo que se movió");
        assert.ok(hist.every((h) => h.changedCriteria.includes("requiredAmenities") && h.triggeringMessageId === A.msg.id), "con el criterio y el mensaje que lo causaron");
        // Un recálculo que da lo mismo no escribe historial.
        const n = hist.length;
        await recomputeScores(org.id, A.conv.id);
        assert.equal((await tx.select().from(schema.leadPropertyScoreHistory).where(eq(schema.leadPropertyScoreHistory.conversationId, A.conv.id))).length, n);

        // 16. Una persona corrige el presupuesto: manda sobre la extracción y la IA no lo pisa después.
        const saved = await saveManualPreferences(org.id, A.conv.id, randomUUID(), { fields: { budgetMax: 200000 }, strict: { budgetMax: true } });
        assert.ok(saved.ok);
        const prof = (await getRecommendations(org.id, A.conv.id, "https://crm.test")).profile.find((p) => p.key === "budgetMax")!;
        assert.equal(prof.value, 200000);
        assert.equal(prof.source, "manual");
        assert.equal(prof.strict, true);
        const t3 = await applyTags({
          organizationId: org.id, contactId: A.contact.id, conversationId: A.conv.id, messageId: A.msg.id,
          decisions: noDecisions, extracted: { presupuesto_max: 260000 },
        });
        assert.ok(!t3.changedCriteria.includes("budgetMax"), "la extracción no pisa lo corregido a mano");
        const prof2 = (await getRecommendations(org.id, A.conv.id, "https://crm.test")).profile.find((p) => p.key === "budgetMax")!;
        assert.equal(prof2.value, 200000);
        // Con 200.000 estricto, las de 240.000 tienen un conflicto duro.
        await recomputeScores(org.id, A.conv.id);
        const rec3 = await getRecommendations(org.id, A.conv.id, "https://crm.test");
        assert.ok(rec3.cartera.every((r) => r.score <= 39 || r.id === lejos.id), "el conflicto duro de presupuesto topa el puntaje");

        // 20. La misma propiedad recibe un puntaje distinto para otro contacto.
        await applyTags({ organizationId: org.id, contactId: B.contact.id, conversationId: B.conv.id, messageId: B.msg.id, decisions: { ...noDecisions, operation: "venta" }, extracted: { zonas: ["Rosario"] } });
        await recomputeScores(org.id, B.conv.id);
        const recB = await getRecommendations(org.id, B.conv.id, "https://crm.test");
        const scoreFor = (recs: typeof rec3, id: string) => recs.cartera.find((r) => r.id === id)?.score;
        assert.notEqual(scoreFor(rec3, conPileta.id), scoreFor(recB, conPileta.id));
        assert.ok((scoreFor(recB, lejos.id) ?? 0) > (scoreFor(recB, conPileta.id) ?? 0), "para el que busca en Rosario, la de Rosario va primero");

        // 8. Archivar no borra el perfil ni los puntajes.
        const stored = (await tx.select().from(schema.leadPropertyScores).where(eq(schema.leadPropertyScores.conversationId, A.conv.id))).length;
        await setConversationStatus(org.id, A.conv.id, "archivada", null);
        assert.equal((await tx.select().from(schema.leadPropertyScores).where(eq(schema.leadPropertyScores.conversationId, A.conv.id))).length, stored);
        assert.ok((await getRecommendations(org.id, A.conv.id, "https://crm.test")).profile.length > 0, "el perfil sigue ahí");
        await setConversationStatus(org.id, A.conv.id, "activa", null);

        // Una propiedad que sale de la cartera sale del ranking al recalcular.
        await tx.update(schema.properties).set({ status: "vendida" }).where(and(eq(schema.properties.id, conPileta.id), eq(schema.properties.organizationId, org.id)));
        await recomputeScores(org.id, A.conv.id);
        assert.ok(!(await ids(A.conv.id)).includes(conPileta.id), "vendida sale del ranking");

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("scoring-db: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
