import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import {
  countVisits,
  getVisit,
  listVisitEvents,
  listVisitHistory,
  listVisitTargets,
  listVisitsByDeal,
  listVisitsByStatus,
} from "../src/lib/visits/queries";

// Ciclo de vida de una visita contra la base REAL con el rol crm_app (no el dueño): valida de paso
// los GRANT y las políticas RLS de la migración 0008.
// Todo corre en una transacción que se revierte: no queda ninguna fila, ni aunque falle.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("visits_test_rollback");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-visitas-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;

        const [org, otra] = await tx
          .insert(schema.organizations)
          .values([
            { name: "Prueba Visitas", slug: `${slug}-a` },
            { name: "Prueba Ajena", slug: `${slug}-b` },
          ])
          .returning();

        const [contact] = await tx
          .insert(schema.contacts)
          .values({ organizationId: org.id, name: "Persona de prueba" })
          .returning();

        const [property] = await tx
          .insert(schema.properties)
          .values({
            organizationId: org.id,
            operation: "venta",
            propertyType: "departamento",
            status: "disponible",
            title: "Depto de prueba",
          })
          .returning();

        const [deal] = await tx
          .insert(schema.deals)
          .values({ organizationId: org.id, contactId: contact.id, title: "Oportunidad de prueba" })
          .returning();

        await tx
          .insert(schema.dealProperties)
          .values({ organizationId: org.id, dealId: deal.id, propertyId: property.id });

        // El formulario ofrece la oportunidad con sus propiedades vinculadas.
        const targets = await listVisitTargets(org.id);
        assert.equal(targets.length, 1, "la oportunidad abierta aparece como destino");
        assert.equal(targets[0].properties.length, 1, "con su propiedad vinculada");
        assert.equal((await listVisitTargets(otra.id)).length, 0, "otra inmobiliaria no ve el destino");

        // Solicitar: pedir NO es tener fecha.
        const [visit] = await tx
          .insert(schema.visits)
          .values({
            organizationId: org.id,
            dealId: deal.id,
            contactId: contact.id,
            propertyId: property.id,
          })
          .returning();
        const solicitada = await getVisit(visit.id, org.id);
        assert.ok(solicitada, "la visita se lee");
        assert.equal(solicitada.status, "solicitada");
        assert.equal(solicitada.scheduledAt, null, "solicitada no tiene fecha");
        assert.equal(solicitada.fromPresentation, false, "se cargó a mano, no desde la red");

        // Aislamiento entre inmobiliarias
        assert.equal(await getVisit(visit.id, otra.id), null, "no se lee desde otra inmobiliaria");
        assert.equal((await listVisitsByStatus(otra.id, ["solicitada"])).length, 0);

        assert.equal((await listVisitsByStatus(org.id, ["solicitada"])).length, 1);
        assert.equal((await listVisitsByStatus(org.id, ["agendada"])).length, 0);

        const where = and(eq(schema.visits.id, visit.id), eq(schema.visits.organizationId, org.id))!;

        // Confirmar fecha
        const primera = new Date(Date.now() + 86_400_000);
        await tx.update(schema.visits).set({ status: "agendada", scheduledAt: primera }).where(where);
        assert.equal((await getVisit(visit.id, org.id))!.status, "agendada");
        assert.equal((await listVisitsByStatus(org.id, ["solicitada"])).length, 0, "ya no está por coordinar");

        // Reprogramar: NO es un estado nuevo, mueve la fecha y queda en el historial.
        const segunda = new Date(Date.now() + 3 * 86_400_000);
        await tx.update(schema.visits).set({ scheduledAt: segunda }).where(where);
        await tx.insert(schema.visitEvents).values({
          organizationId: org.id,
          visitId: visit.id,
          action: "reprogramada",
          fromValue: primera.toISOString(),
          toValue: segunda.toISOString(),
        });
        const reprogramada = (await getVisit(visit.id, org.id))!;
        assert.equal(reprogramada.status, "agendada", "reprogramar no cambia el estado");
        assert.equal(new Date(reprogramada.scheduledAt!).getTime(), segunda.getTime());

        const events = await listVisitEvents(visit.id, org.id);
        assert.equal(events.length, 1);
        assert.equal(events[0].action, "reprogramada");
        assert.ok(events[0].fromValue, "el historial conserva la fecha anterior");
        assert.equal((await listVisitEvents(visit.id, otra.id)).length, 0, "el historial no se filtra");

        const counts = await countVisits(org.id);
        assert.equal(counts.agendadas, 1);
        assert.equal(counts.solicitadas, 0);

        // Resultado después de la cita
        await tx
          .update(schema.visits)
          .set({ status: "realizada", completedAt: new Date(), notes: "Le gustó, pide una segunda visita" })
          .where(where);
        const realizada = (await getVisit(visit.id, org.id))!;
        assert.equal(realizada.status, "realizada");
        assert.ok(realizada.notes, "queda la nota de seguimiento");
        assert.equal((await listVisitsByStatus(org.id, ["agendada"])).length, 0, "sale de coordinadas");
        assert.ok((await listVisitHistory(org.id)).some((v) => v.id === visit.id), "aparece en el historial");

        // Una oportunidad puede acumular varias visitas, incluso a propiedades distintas.
        const [otraProp] = await tx
          .insert(schema.properties)
          .values({
            organizationId: org.id,
            operation: "venta",
            propertyType: "casa",
            status: "disponible",
            title: "Casa de prueba",
          })
          .returning();
        await tx.insert(schema.visits).values({
          organizationId: org.id,
          dealId: deal.id,
          contactId: contact.id,
          propertyId: otraProp.id,
        });
        assert.equal((await listVisitsByDeal(deal.id, org.id)).length, 2, "la oportunidad acumula visitas");

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("visits: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
