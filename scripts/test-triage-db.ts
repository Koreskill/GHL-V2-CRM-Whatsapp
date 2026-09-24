import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { buildTriageContext, stateForDecision } from "../src/lib/agent/triage/context";
import {
  countPendingTriage,
  getLatestTriage,
  getTriageStats,
  listPendingTriage,
  resolveTriage,
} from "../src/lib/agent/triage/queries";

// Persistencia del triaje contra la base REAL con el rol crm_app. Todo en una transacción que
// se revierte. NO llama a ningún modelo: la clasificación se simula insertando las filas.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("triage_db_rollback");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-triaje-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;

        const [org, otra] = await tx
          .insert(schema.organizations)
          .values([
            { name: "Prueba Triaje", slug: `${slug}-a` },
            { name: "Prueba Ajena", slug: `${slug}-b` },
          ])
          .returning();

        const [contact] = await tx
          .insert(schema.contacts)
          .values({ organizationId: org.id, name: "Ana Prueba" })
          .returning();

        const [account] = await tx
          .insert(schema.channelAccounts)
          .values({
            organizationId: org.id,
            provider: "zernio",
            channel: "whatsapp",
            externalId: `acct-${randomUUID()}`,
          })
          .returning();

        const [conv] = await tx
          .insert(schema.conversations)
          .values({
            organizationId: org.id,
            accountId: account.id,
            contactId: contact.id,
            channel: "whatsapp",
            provider: "zernio",
            externalId: `conv-${randomUUID()}`,
            lastInboundAt: new Date(),
          })
          .returning();

        const [incoming] = await tx
          .insert(schema.messages)
          .values({
            organizationId: org.id,
            conversationId: conv.id,
            channel: "whatsapp",
            provider: "zernio",
            direction: "inbound",
            type: "text",
            status: "received",
            body: "Hola, busco un 2 ambientes en Palermo para comprar.",
            sentAt: new Date(),
          })
          .returning();

        // ── Contexto: aislado por inmobiliaria y sin datos privados ──
        const [property] = await tx
          .insert(schema.properties)
          .values({
            organizationId: org.id,
            operation: "venta",
            propertyType: "departamento",
            status: "disponible",
            title: "Depto Palermo",
            zone: "Palermo",
            price: "120000",
            internalNotes: "SECRETO: el dueño acepta 110k",
          })
          .returning();

        const [deal] = await tx
          .insert(schema.deals)
          .values({ organizationId: org.id, contactId: contact.id, title: "Ana - compra" })
          .returning();
        await tx
          .insert(schema.dealProperties)
          .values({ organizationId: org.id, dealId: deal.id, propertyId: property.id });

        const ctx = await buildTriageContext({
          organizationId: org.id,
          conversationId: conv.id,
          channel: "whatsapp",
          contactId: contact.id,
          incomingText: "Hola, busco un 2 ambientes en Palermo para comprar.",
        });

        assert.equal(ctx.contactoNombre, "Ana Prueba");
        assert.equal(ctx.oportunidad?.id, deal.id);
        assert.equal(ctx.propiedadesDeInteres.length, 1, "trae la propiedad de la oportunidad");
        assert.ok(
          ctx.propiedadesDeInteres[0].datosFaltantes.includes("superficie"),
          "señala qué dato falta, para que el modelo no lo invente",
        );

        // Lo privado del equipo NO puede viajar a un modelo que después le escribe al cliente.
        const serializado = JSON.stringify(ctx);
        assert.ok(!serializado.includes("SECRETO"), "las notas internas no salen en el contexto");

        // El estado que va a Jev es más chico que el que va a GPT: se paga por token de entrada.
        const state = stateForDecision(ctx);
        assert.ok(JSON.stringify(state).length < serializado.length, "a Jev se le manda menos");

        // Aislamiento: con otra inmobiliaria no aparece nada de esta.
        const ajeno = await buildTriageContext({
          organizationId: otra.id,
          conversationId: conv.id,
          channel: "whatsapp",
          contactId: contact.id,
          incomingText: "hola",
        });
        assert.equal(ajeno.oportunidad, null, "otra inmobiliaria no ve la oportunidad");
        assert.equal(ajeno.contactoNombre, null, "ni el contacto");
        assert.equal(ajeno.historial.length, 0, "ni el historial");

        // ── Idempotencia: el mismo mensaje no se procesa dos veces ──
        const claim = () =>
          tx
            .insert(schema.messageTriage)
            .values({
              organizationId: org.id,
              conversationId: conv.id,
              messageId: incoming.id,
              status: "error",
              error: "en proceso",
            })
            .onConflictDoNothing({ target: schema.messageTriage.messageId })
            .returning({ id: schema.messageTriage.id });

        const primero = await claim();
        assert.equal(primero.length, 1, "la primera corrida reclama el mensaje");
        const segundo = await claim();
        assert.equal(segundo.length, 0, "la segunda no lo vuelve a procesar");

        // ── Lectura de lo que quedó pendiente ──
        await tx
          .update(schema.messageTriage)
          .set({
            status: "borrador",
            intent: "buy",
            intentConfidence: "0.82",
            intentProbabilities: { buy: 0.82, rent: 0.1 },
            containsVisitRequest: "0.05",
            requiresHuman: "0.08",
            urgency: "medio",
            route: "busqueda_compra",
            routeReason: "Intención buy",
            draftText: "Hola Ana, tengo un 2 ambientes en Palermo.",
            decisionModel: "typesafe/jev-1.13",
            replyModel: "openai/gpt-4.1-mini",
            error: null,
          })
          .where(eq(schema.messageTriage.id, primero[0].id));

        const latest = await getLatestTriage(conv.id, org.id);
        assert.equal(latest?.intent, "buy");
        assert.equal(latest?.intentConfidence, 0.82, "las probabilidades vuelven como número");
        assert.deepEqual(latest?.intentProbabilities, { buy: 0.82, rent: 0.1 });
        assert.equal(latest?.status, "borrador");
        assert.equal(await getLatestTriage(conv.id, otra.id), null, "no se lee desde otra inmobiliaria");

        assert.equal(await countPendingTriage(org.id), 1);
        assert.equal(await countPendingTriage(otra.id), 0);
        assert.equal((await listPendingTriage(org.id)).length, 1);
        assert.equal((await listPendingTriage(otra.id)).length, 0);

        const stats = await getTriageStats(org.id);
        assert.equal(stats.total, 1);
        assert.equal(stats.pendientes, 1);
        assert.equal(stats.confianzaMedia, 0.82);

        // Atenderlo lo saca de pendientes pero conserva la clasificación para recalibrar.
        await resolveTriage(primero[0].id, org.id);
        assert.equal(await countPendingTriage(org.id), 0);
        assert.equal((await getLatestTriage(conv.id, org.id))?.intent, "buy", "la clasificación no se borra");

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("triage-db: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
