import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { __ensureDeal as ensureDeal, __recordShown as recordShown, __recordVisitRequest as recordVisitRequest } from "../src/lib/agent/triage/run";

// Lo que run.ts guarda cuando el bot contesta: la oportunidad, las propiedades mostradas y el
// pedido de visita. Contra la base REAL con el rol crm_app, en una transacción que se revierte.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("run_records_rollback");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-run-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;

        const [org, otra] = await tx
          .insert(schema.organizations)
          .values([
            { name: "Prueba Run", slug: `${slug}-a` },
            { name: "Prueba Ajena", slug: `${slug}-b` },
          ])
          .returning();
        const [contact] = await tx.insert(schema.contacts).values({ organizationId: org.id, name: "Ana" }).returning();
        const [account] = await tx
          .insert(schema.channelAccounts)
          .values({ organizationId: org.id, provider: "zernio", channel: "whatsapp", externalId: `a-${randomUUID()}` })
          .returning();
        const [conv] = await tx
          .insert(schema.conversations)
          .values({
            organizationId: org.id,
            accountId: account.id,
            contactId: contact.id,
            channel: "whatsapp",
            provider: "zernio",
            externalId: `c-${randomUUID()}`,
          })
          .returning();
        const [p1, p2] = await tx
          .insert(schema.properties)
          .values([
            { organizationId: org.id, operation: "venta", propertyType: "departamento", status: "disponible", title: "Uno" },
            { organizationId: org.id, operation: "venta", propertyType: "casa", status: "disponible", title: "Dos" },
          ])
          .returning();

        const base = { organizationId: org.id, contactId: contact.id, conversationId: conv.id };

        // ── Una sola oportunidad por contacto ──
        const d1 = await ensureDeal(base);
        const d2 = await ensureDeal(base);
        assert.equal(d1, d2, "no se duplica la oportunidad del contacto");
        const [deal] = await tx.select().from(schema.deals).where(eq(schema.deals.id, d1));
        assert.equal(deal.stage, "prospecto");
        assert.equal(deal.conversationId, conv.id, "queda atada a la conversación de la que nació");

        // ── Propiedades mostradas: varias, sin duplicar ──
        await recordShown({ ...base, propertyIds: [p1.id, p2.id] });
        await recordShown({ ...base, propertyIds: [p1.id] });
        const shown = await tx.select().from(schema.dealProperties).where(eq(schema.dealProperties.dealId, d1));
        assert.equal(shown.length, 2, "una oportunidad con dos propiedades, sin repetir la que se volvió a mostrar");

        // ── Pedido de visita ──
        await recordVisitRequest({ ...base, propertyId: p1.id, note: "Lo que pidió el cliente: «el sábado a las 11»" });
        let v = await tx.select().from(schema.visits).where(and(eq(schema.visits.dealId, d1), eq(schema.visits.propertyId, p1.id)));
        assert.equal(v.length, 1);
        assert.equal(v[0].status, "solicitada", "el bot no confirma: queda solicitada");
        assert.equal(v[0].scheduledAt, null, "sin fecha: la confirma el asesor");
        assert.match(v[0].notes ?? "", /sábado a las 11/, "lo que pidió queda para el asesor");

        // Un segundo pedido a la misma propiedad no crea otra visita: suma la nota.
        await recordVisitRequest({ ...base, propertyId: p1.id, note: "Lo que pidió el cliente: «mejor el domingo»" });
        v = await tx.select().from(schema.visits).where(and(eq(schema.visits.dealId, d1), eq(schema.visits.propertyId, p1.id)));
        assert.equal(v.length, 1, "no duplica la visita");
        assert.match(v[0].notes ?? "", /domingo/);
        assert.match(v[0].notes ?? "", /sábado/, "conserva lo anterior");

        const events = await tx.select().from(schema.visitEvents).where(eq(schema.visitEvents.visitId, v[0].id));
        assert.equal(events.length, 1, "queda en el historial de la visita");

        // Una visita ya cerrada no bloquea pedir otra.
        await tx.update(schema.visits).set({ status: "realizada" }).where(eq(schema.visits.id, v[0].id));
        await recordVisitRequest({ ...base, propertyId: p1.id, note: "Quiere volver a verla" });
        v = await tx.select().from(schema.visits).where(and(eq(schema.visits.dealId, d1), eq(schema.visits.propertyId, p1.id)));
        assert.equal(v.length, 2, "después de una visita realizada se puede pedir otra");

        // Todo queda en la organización correcta.
        const ajenas = await tx.select().from(schema.visits).where(eq(schema.visits.organizationId, otra.id));
        assert.equal(ajenas.length, 0);

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("run-records: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
