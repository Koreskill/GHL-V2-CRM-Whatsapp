import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import {
  getDeal,
  listBoardDeals,
  listClosedDeals,
  listDealEvents,
  listDealProperties,
} from "../src/lib/deals/queries";

// Pipeline contra la base REAL con el rol crm_app de la app (no el dueño): valida de paso que los
// GRANT y las políticas RLS de la migración 0007 están bien puestos.
// Todo corre dentro de una transacción que se revierte: no queda ninguna fila, ni aunque falle.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("deals_test_rollback");

// Helper chico para no repetir el and(eq(...), eq(...)) de cada update.
function andEq(a: PgColumn, av: string, b: PgColumn, bv: string): SQL {
  return and(eq(a, av), eq(b, bv))!;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-deals-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;

        const [org, otra] = await tx
          .insert(schema.organizations)
          .values([
            { name: "Prueba Pipeline", slug: `${slug}-a` },
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

        // Arranca en prospecto, abierta y sin valor: el valor es opcional a propósito.
        const inicial = await getDeal(deal.id, org.id);
        assert.ok(inicial, "la oportunidad se lee");
        assert.equal(inicial.stage, "prospecto");
        assert.equal(inicial.status, "abierta");
        assert.equal(inicial.value, null, "el valor arranca vacío");

        // Aislamiento entre inmobiliarias
        assert.equal(await getDeal(deal.id, otra.id), null, "no se lee desde otra inmobiliaria");
        assert.ok((await listBoardDeals(org.id)).some((d) => d.id === deal.id), "aparece en su tablero");
        assert.equal((await listBoardDeals(otra.id)).length, 0, "no aparece en el tablero de otra");

        // Mover de etapa
        await tx.update(schema.deals).set({ stage: "negociacion" }).where(eqDeal(deal.id));
        assert.equal((await getDeal(deal.id, org.id))!.stage, "negociacion");

        // Varias propiedades de interés, sin duplicar la misma
        await tx.insert(schema.dealProperties).values({
          organizationId: org.id,
          dealId: deal.id,
          propertyId: property.id,
        });
        await tx
          .insert(schema.dealProperties)
          .values({ organizationId: org.id, dealId: deal.id, propertyId: property.id })
          .onConflictDoNothing();
        assert.equal((await listDealProperties(deal.id, org.id)).length, 1, "la misma propiedad no se vincula dos veces");

        // Perder: conserva la etapa donde se cayó y sale del tablero
        await tx
          .update(schema.deals)
          .set({ status: "perdida", lostReason: "Motivo de prueba", closedAt: new Date() })
          .where(eqDeal(deal.id));
        const perdida = (await getDeal(deal.id, org.id))!;
        assert.equal(perdida.status, "perdida");
        assert.equal(perdida.stage, "negociacion", "la perdida NO salta a cerrado_ganado");
        assert.equal(perdida.lostReason, "Motivo de prueba");
        assert.ok(!(await listBoardDeals(org.id)).some((d) => d.id === deal.id), "una perdida no ocupa columna");
        assert.ok((await listClosedDeals(org.id)).some((d) => d.id === deal.id), "aparece en cerradas");

        // Historial
        await tx.insert(schema.dealEvents).values({
          organizationId: org.id,
          dealId: deal.id,
          action: "etapa",
          fromValue: "prospecto",
          toValue: "negociacion",
        });
        const events = await listDealEvents(deal.id, org.id);
        assert.equal(events.length, 1);
        assert.equal(events[0].toValue, "negociacion");
        assert.equal((await listDealEvents(deal.id, otra.id)).length, 0, "el historial no se filtra a otra inmobiliaria");

        checked = true;
        throw rollback;

        function eqDeal(id: string) {
          return andEq(schema.deals.id, id, schema.deals.organizationId, org.id);
        }
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("deals: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
