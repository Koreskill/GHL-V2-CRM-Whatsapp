import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { saveRequirements, runMatching, listMatches } from "../src/lib/matching/queries";
import { createPresentation, listPresentations, requestVisit } from "../src/lib/presentations/queries";
import { createProperty, listNetworkCatalog, publishToNetwork } from "../src/lib/properties/queries";

// Usa las funciones de producción con la misma conexión transaccional. Ninguna fila
// de prueba queda en la base, incluso si falla una aserción a mitad del flujo.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("network_flow_test_rollback");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-red-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;

        const [owner, broker, outsider] = await tx
          .insert(schema.organizations)
          .values([
            { name: "Prueba Dueña", slug: `${slug}-duena` },
            { name: "Prueba Presentadora", slug: `${slug}-presentadora` },
            { name: "Prueba Externa", slug: `${slug}-externa` },
          ])
          .returning();
        const [network] = await tx
          .insert(schema.networks)
          .values({ name: "Red de prueba", slug })
          .returning();

        await tx.insert(schema.networkMembers).values([
          { networkId: network.id, organizationId: owner.id, status: "activa", joinedAt: new Date() },
          { networkId: network.id, organizationId: broker.id, status: "activa", joinedAt: new Date() },
          { networkId: network.id, organizationId: outsider.id, status: "invitada" },
        ]);

        const property = await createProperty(owner.id, {
          operation: "venta",
          propertyType: "departamento",
          status: "disponible",
          title: "Departamento de prueba",
          price: "150000",
          currency: "USD",
          addressFull: "Dirección privada de prueba",
          zone: "Palermo",
          city: "Buenos Aires",
          bedrooms: 3,
          bathrooms: 2,
          areaM2: "80",
          features: { cochera: true, balcon: true },
          internalNotes: "Nota privada de prueba",
        });

        const published = await publishToNetwork(owner.id, property.id, network.id, {
          collaborationTerms: { commissionPercent: 3 },
        });
        assert.equal(published.ok, true, "la inmobiliaria dueña publica en la red");
        assert.equal(published.listing.ownerOrganizationId, owner.id);
        assert.equal("addressFull" in published.listing, false, "el catálogo no muestra dirección privada");
        assert.equal("internalNotes" in published.listing, false, "el catálogo no muestra notas internas");

        const visible = await listNetworkCatalog(broker.id);
        assert.deepEqual(visible.map((listing) => listing.id), [published.listing.id]);
        assert.deepEqual(await listNetworkCatalog(outsider.id), [], "una membresía invitada no ve el catálogo");
        assert.deepEqual(await listNetworkCatalog(randomUUID()), [], "un tercero no ve el catálogo");

        const expensiveProperty = await createProperty(owner.id, {
          operation: "venta",
          propertyType: "departamento",
          status: "disponible",
          price: "300000",
          currency: "USD",
          zone: "Palermo",
          bedrooms: 3,
          bathrooms: 2,
          areaM2: "80",
          features: { cochera: true },
        });
        const expensiveListing = await publishToNetwork(owner.id, expensiveProperty.id, network.id);
        assert.equal(expensiveListing.ok, true);

        const [contact] = await tx
          .insert(schema.contacts)
          .values({ organizationId: broker.id, name: "Prospecto de prueba" })
          .returning();
        const requirement = await saveRequirements(broker.id, {
          contactId: contact.id,
          operation: "venta",
          propertyTypes: ["departamento"],
          zones: ["Palermo"],
          bedroomsMin: 3,
          bathroomsMin: 2,
          priceMin: "100000",
          priceMax: "200000",
          currency: "USD",
          areaMin: "70",
          mustHave: ["cochera"],
          niceToHave: ["balcon"],
        });

        const matches = await runMatching(broker.id, requirement.id);
        assert.equal(matches.length, 1, "el prospecto recibe una coincidencia y se excluye la propiedad fuera de presupuesto");
        assert.equal(matches[0].listingId, published.listing.id);
        assert.ok(matches[0].score > 0.9, "la coincidencia tiene puntaje alto");
        const persisted = await listMatches(broker.id, requirement.id);
        assert.equal(persisted.length, 1, "el match se guarda en el tenant del prospecto");
        assert.deepEqual(await listMatches(owner.id, requirement.id), [], "el dueño no ve matches ajenos");
        assert.deepEqual(await runMatching(outsider.id, requirement.id), [], "un tercero no cruza perfiles ajenos");

        const presentation = await createPresentation(broker.id, {
          networkPropertyListingId: published.listing.id,
          prospectContactId: contact.id,
          prospectRequirementId: requirement.id,
          matchId: persisted[0].id,
        });
        assert.equal(presentation.ok, true, "la inmobiliaria presenta la propiedad");
        assert.equal(presentation.presentation.ownerNotifiedAt, null, "presentar no notifica al dueño");
        assert.deepEqual(presentation.presentation.commissionTerms, { commissionPercent: 3 });
        assert.equal((await listPresentations(owner.id)).length, 1);
        assert.equal((await listPresentations(broker.id)).length, 1);
        assert.deepEqual(await listPresentations(outsider.id), []);

        const visit = await requestVisit(broker.id, presentation.presentation.id);
        assert.equal(visit?.status, "visita_solicitada");
        assert.ok(visit.ownerNotifiedAt, "la solicitud de visita habilita la notificación");
        assert.equal(await requestVisit(outsider.id, presentation.presentation.id), null);

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    assert.equal(checked, true, "el flujo terminó antes del rollback");
    const remaining = await client`select count(*)::int as count from networks where slug = ${slug}`;
    assert.equal(remaining[0].count, 0, "la transacción no deja la red de prueba en la base");
    console.log("network flow: OK (publicación, catálogo, matching, presentación, visita, aislamiento; rollback verificado)");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
