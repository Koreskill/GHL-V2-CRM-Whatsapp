import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { getCatalogSummary, listCatalog } from "../src/lib/properties/catalog";
import { countOpenIncidents, listIncidents, reportIncident, resolveIncidents } from "../src/lib/incidents/report";
import { getTypingState, setAgentTyping, clearAgentTyping } from "../src/lib/inbox/typing";

// Catálogo, bandeja de incidentes e indicador "escribiendo…" contra la base REAL con el rol
// crm_app. Todo dentro de una transacción que se revierte: no queda ninguna fila.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("sync_test_rollback");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-sync-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;

        const [org, otra] = await tx
          .insert(schema.organizations)
          .values([
            { name: "Prueba Cartera", slug: `${slug}-a` },
            { name: "Prueba Ajena", slug: `${slug}-b` },
          ])
          .returning();

        // ─── Catálogo: filtros y aislamiento ───
        await tx.insert(schema.properties).values([
          {
            organizationId: org.id,
            externalId: "P-1",
            source: "google_sheets",
            operation: "venta",
            propertyType: "departamento",
            status: "disponible",
            title: "Depto Palermo",
            zone: "Palermo",
            price: "120000",
            syncIssues: ["Sin portada"],
          },
          {
            organizationId: org.id,
            externalId: "P-2",
            source: "google_sheets",
            operation: "alquiler",
            propertyType: "casa",
            status: "pausada",
            title: "Casa Tigre",
            zone: "Tigre",
            price: "900",
          },
        ]);

        assert.equal((await listCatalog(org.id, {})).length, 2);
        assert.equal((await listCatalog(org.id, { operation: "venta" })).length, 1, "filtra por operación");
        assert.equal((await listCatalog(org.id, { status: "disponible" })).length, 1, "filtra por estado");
        assert.equal((await listCatalog(org.id, { zone: "paler" })).length, 1, "filtra por zona, sin distinguir mayúsculas");
        assert.equal((await listCatalog(org.id, { priceMin: 100000 })).length, 1, "filtra por precio mínimo");
        assert.equal((await listCatalog(org.id, { q: "P-2" })).length, 1, "busca por property_id");
        assert.equal((await listCatalog(otra.id, {})).length, 0, "otra inmobiliaria no ve la cartera");

        const summary = await getCatalogSummary(org.id);
        assert.equal(summary.total, 2);
        assert.equal(summary.disponibles, 1, "una pausada no cuenta como disponible");
        assert.equal(summary.conAvisos, 1, "la que tiene sync_issues se cuenta aparte");

        // El property_id es único POR inmobiliaria: dos clientes pueden usar el mismo en su hoja.
        await tx.insert(schema.properties).values({
          organizationId: otra.id,
          externalId: "P-1",
          source: "google_sheets",
          operation: "venta",
          propertyType: "casa",
          title: "Otra casa",
        });
        assert.equal((await listCatalog(otra.id, {})).length, 1, "el mismo property_id convive entre inmobiliarias");

        // Repetirlo DENTRO de la misma inmobiliaria sí tiene que fallar.
        // Va en una transacción anidada (SAVEPOINT): un error de Postgres aborta la transacción
        // entera, así que sin el savepoint no se podría seguir probando después.
        let duplicado = false;
        await tx
          .transaction(async (sp) => {
            await sp.insert(schema.properties).values({
              organizationId: org.id,
              externalId: "P-1",
              source: "google_sheets",
              operation: "venta",
              propertyType: "casa",
            });
          })
          .catch(() => {
            duplicado = true;
          });
        assert.ok(duplicado, "property_id repetido en la misma inmobiliaria se rechaza");

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    // Segunda transacción: el índice único abortó la anterior, así que se sigue en una limpia.
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;

        const [org] = await tx
          .insert(schema.organizations)
          .values({ name: "Prueba Incidentes", slug: `${slug}-c` })
          .returning();

        // ─── Bandeja de incidentes ───
        await reportIncident({
          organizationId: org.id,
          module: "sheets",
          key: "lectura",
          message: "No se pudo leer la hoja",
          detail: new Error("403 Forbidden"),
          retryTarget: "sheets:sync",
        });
        await reportIncident({
          organizationId: org.id,
          module: "sheets",
          key: "lectura",
          message: "No se pudo leer la hoja",
        });

        const open = await listIncidents({ organizationId: org.id });
        assert.equal(open.length, 1, "el mismo problema se agrupa en vez de llenar la bandeja");
        assert.equal(open[0].occurrences, 2, "y sube el contador");
        assert.equal(open[0].retryTarget, "sheets:sync");
        assert.equal(await countOpenIncidents(org.id), 1);

        await resolveIncidents(org.id, "sheets", "lectura");
        assert.equal(await countOpenIncidents(org.id), 0, "se resuelve cuando deja de fallar");

        // Si vuelve a pasar, se reabre en vez de quedar tapado como resuelto.
        await reportIncident({
          organizationId: org.id,
          module: "sheets",
          key: "lectura",
          message: "No se pudo leer la hoja",
        });
        assert.equal(await countOpenIncidents(org.id), 1, "vuelve a abrirse");

        // ─── Indicador "escribiendo…" ───
        const [contact] = await tx
          .insert(schema.contacts)
          .values({ organizationId: org.id, name: "Persona" })
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
          })
          .returning();

        assert.equal((await getTypingState(conv.id, org.id)).agent, false, "arranca apagado");
        await setAgentTyping(conv.id, org.id, tx as Db);
        assert.equal((await getTypingState(conv.id, org.id)).agent, true, "el agente aparece escribiendo");
        await clearAgentTyping(conv.id, org.id, tx as Db);
        assert.equal((await getTypingState(conv.id, org.id)).agent, false, "se limpia al terminar");

        // Una marca vieja se ignora sola: si un proceso muere, no queda pegada para siempre.
        await tx
          .update(schema.conversations)
          .set({ agentTypingSince: new Date(Date.now() - 60_000) })
          .where(and(eq(schema.conversations.id, conv.id), eq(schema.conversations.organizationId, org.id)));
        assert.equal((await getTypingState(conv.id, org.id)).agent, false, "una marca vencida no se muestra");

        // Nadie tiene que verse a sí mismo escribiendo.
        const userId = randomUUID();
        await tx
          .update(schema.conversations)
          .set({ humanTypingSince: new Date(), humanTypingUserId: userId })
          .where(eq(schema.conversations.id, conv.id));
        assert.equal((await getTypingState(conv.id, org.id, userId)).human, false, "no se ve a sí mismo");
        assert.equal((await getTypingState(conv.id, org.id, randomUUID())).human, true, "sí lo ve otro usuario");

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("sync+incidents+typing: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
