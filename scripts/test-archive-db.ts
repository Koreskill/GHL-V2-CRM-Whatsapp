import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { listConversations, listMessages } from "../src/lib/inbox/queries";
import { countByStatus, setConversationStatus } from "../src/lib/inbox/status";

// Archivar / desarchivar contra la base REAL con el rol crm_app. Todo dentro de una transacción que
// se revierte: no queda ninguna fila.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("archive_test_rollback");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-archivo-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;
        const [org, otra] = await tx.insert(schema.organizations).values([{ name: "Prueba Archivo", slug: `${slug}-a` }, { name: "Prueba Ajena", slug: `${slug}-b` }]).returning();
        const [contact] = await tx.insert(schema.contacts).values({ organizationId: org.id, name: "Persona Funes" }).returning();
        const [conv] = await tx
          .insert(schema.conversations)
          .values({ organizationId: org.id, contactId: contact.id, channel: "whatsapp", provider: "zernio", externalId: `x-${randomUUID()}`, accountId: "acc", participantName: "Persona Funes", lastMessageAt: new Date() })
          .returning();
        await tx.insert(schema.messages).values([
          { organizationId: org.id, conversationId: conv.id, channel: "whatsapp", provider: "zernio", direction: "inbound", body: "Busco casa en Funes", status: "received" },
          { organizationId: org.id, conversationId: conv.id, channel: "whatsapp", provider: "zernio", direction: "outbound", body: "Te paso opciones", status: "sent" },
        ]);
        const history = await listMessages(conv.id, org.id);
        assert.equal(history.length, 2);

        const ids = async (tab: "activas" | "archivadas" | "desactivas", q?: string) => (await listConversations(org.id, { tab, q })).map((c) => c.id);

        // Nace activa.
        assert.ok((await ids("activas")).includes(conv.id));
        assert.ok(!(await ids("archivadas")).includes(conv.id));

        // 5 y 6. Archivada: sale de Activas y aparece en Archivadas (y se puede buscar).
        assert.equal(await setConversationStatus(org.id, conv.id, "archivada", null), true);
        assert.ok(!(await ids("activas")).includes(conv.id), "archivada no está en Activas");
        assert.ok((await ids("archivadas")).includes(conv.id), "archivada aparece en Archivadas");
        assert.ok((await ids("archivadas", "Funes")).includes(conv.id), "sigue siendo buscable");
        assert.equal((await countByStatus(org.id)).archivada, 1);
        assert.equal((await countByStatus(org.id)).activa, 0);

        // Archivar dos veces no hace nada y no escribe otro evento.
        assert.equal(await setConversationStatus(org.id, conv.id, "archivada", null), false);

        // 8. El historial sigue intacto mientras está archivada (el perfil y los puntajes se prueban en test-scoring-db).
        assert.equal((await listMessages(conv.id, org.id)).length, 2, "el historial no cambia");
        // Otra inmobiliaria no puede archivarla ni verla.
        assert.equal(await setConversationStatus(otra.id, conv.id, "activa", null), false, "otro tenant no la toca");
        assert.deepEqual(await listConversations(otra.id, { tab: "archivadas" }), []);

        // 7. Desarchivar la devuelve a Activas.
        assert.equal(await setConversationStatus(org.id, conv.id, "activa", null), true);
        assert.ok((await ids("activas")).includes(conv.id), "vuelve a Activas");
        assert.ok(!(await ids("archivadas")).includes(conv.id));
        assert.equal((await listMessages(conv.id, org.id)).length, 2, "el historial sigue igual tras desarchivar");

        // El rastro: dos cambios de estado registrados.
        const events = await tx
          .select()
          .from(schema.conversationEvents)
          .where(and(eq(schema.conversationEvents.conversationId, conv.id), eq(schema.conversationEvents.action, "estado")));
        assert.deepEqual(events.map((e) => `${e.fromValue}>${e.toValue}`).sort(), ["activa>archivada", "archivada>activa"]);

        // Desactiva es otro estado: no es lo mismo que archivada.
        assert.equal(await setConversationStatus(org.id, conv.id, "desactiva", null), true);
        assert.ok((await ids("desactivas")).includes(conv.id));
        assert.ok(!(await ids("archivadas")).includes(conv.id));

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("archive-db: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
