import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import type { DecisionAnswer } from "../src/lib/ai/decisions";
import { readTagDecisions, applyTags, markPropertyInterest } from "../src/lib/agent/triage/tags";
import { __parseExtractionForTests as parseExtraction } from "../src/lib/agent/triage/extract";
import { listPropertyInterest } from "../src/lib/properties/catalog";

// Etiquetado del contacto contra la base REAL con el rol crm_app, en una transacción que se
// revierte. La parte pura (lectura de decisiones y de la extracción) no toca la base.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("tags_rollback");

// ─── Lectura de las decisiones tipadas ──────────────────────────────────────
{
  const answers: Record<string, DecisionAnswer> = {
    operacion: { type: "choice", choice: "alquiler", confidence: 0.9 },
    tipo_propiedad: { type: "choice", choice: "departamento", confidence: 0.8 },
    urgencia: { type: "score", score: 1.9, confidence: 0.7 },
    forma_pago: { type: "choice", choice: "credito", confidence: 0.6 },
    temperatura: { type: "score", score: 1.2, confidence: 0.8 },
    interes_propiedad: { type: "noul", noul: 0.91 },
  };
  const d = readTagDecisions(answers);
  assert.equal(d.operation, "alquiler");
  assert.equal(d.propertyType, "departamento");
  assert.equal(d.urgency, "ya", "1.9 redondea al nivel más urgente");
  assert.equal(d.paymentMethod, "credito");
  assert.equal(d.temperature, "tibio", "1.2 redondea a tibio");
  assert.equal(d.interestedInShownProperty, 0.91);
}
{
  // "desconocida" NO es un valor: es que el contacto no lo dijo. Tiene que quedar en null para
  // no pisar lo que ya se sabía de mensajes anteriores.
  const d = readTagDecisions({
    operacion: { type: "choice", choice: "desconocida", confidence: 0.95 },
    tipo_propiedad: { type: "choice", choice: "desconocido", confidence: 0.9 },
    forma_pago: { type: "choice", choice: "desconocida", confidence: 0.9 },
  });
  assert.equal(d.operation, null);
  assert.equal(d.propertyType, null);
  assert.equal(d.paymentMethod, null);
  assert.equal(d.temperature, null, "sin respuesta no se inventa una temperatura");
  assert.equal(d.interestedInShownProperty, 0);
}

// ─── Extracción de los valores libres ───────────────────────────────────────
{
  const f = parseExtraction(
    JSON.stringify({ zonas: ["Pichincha", "Centro"], presupuesto_max: 60000, moneda: "ars", ambientes: 2 }),
  );
  assert.deepEqual(f?.zonas, ["Pichincha", "Centro"]);
  assert.equal(f?.presupuesto_max, 60000);
  assert.equal(f?.moneda, "ARS", "la moneda se normaliza a mayúsculas");
  assert.equal(f?.ambientes, 2);
  assert.equal(f?.presupuesto_min, undefined, "lo que no vino no se toca");

  // {} es válido: significa "no hay nada nuevo", no un error.
  assert.deepEqual(parseExtraction("{}"), {});

  // null es distinto de ausente: vacía el campo a propósito.
  const vaciar = parseExtraction(JSON.stringify({ presupuesto_max: null }));
  assert.ok(vaciar && "presupuesto_max" in vaciar);
  assert.equal(vaciar.presupuesto_max, null);

  // Valores fuera de rango o del tipo equivocado se descartan en vez de guardarse.
  const basura = parseExtraction(JSON.stringify({ presupuesto_max: -5, ambientes: 999, moneda: "pesos", zonas: [1, 2] }));
  assert.equal(basura?.presupuesto_max, undefined, "un presupuesto negativo no se guarda");
  assert.equal(basura?.ambientes, undefined, "999 ambientes no es un dato real");
  assert.equal(basura?.moneda, undefined, "la moneda tiene que ser un código de 3 letras");
  assert.equal(basura?.zonas, undefined, "las zonas tienen que ser textos");

  assert.equal(parseExtraction("no soy json"), null);
  assert.equal(parseExtraction("[1,2]"), null, "un array no es un perfil");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");

  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-tags-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;

        const [org, otra] = await tx
          .insert(schema.organizations)
          .values([
            { name: "Prueba Tags", slug: `${slug}-a` },
            { name: "Prueba Ajena", slug: `${slug}-b` },
          ])
          .returning();

        const [contact] = await tx
          .insert(schema.contacts)
          .values({ organizationId: org.id, name: "Juan García", phone: "+5491100000000" })
          .returning();

        const [conv] = await tx
          .insert(schema.conversations)
          .values({
            organizationId: org.id,
            accountId: (
              await tx
                .insert(schema.channelAccounts)
                .values({
                  organizationId: org.id,
                  provider: "zernio",
                  channel: "whatsapp",
                  externalId: `acct-${randomUUID()}`,
                })
                .returning()
            )[0].id,
            contactId: contact.id,
            channel: "whatsapp",
            provider: "zernio",
            externalId: `conv-${randomUUID()}`,
          })
          .returning();

        // ── Primer mensaje: crea el perfil ──
        await applyTags({
          organizationId: org.id,
          contactId: contact.id,
          conversationId: conv.id,
          decisions: {
            operation: "alquiler",
            propertyType: "departamento",
            urgency: "ya",
            paymentMethod: null,
            temperature: "tibio",
            interestedInShownProperty: 0,
          },
          extracted: { zonas: ["Pichincha"], presupuesto_max: 60000, moneda: "ARS" },
        });

        const [perfil1] = await tx
          .select()
          .from(schema.prospectRequirements)
          .where(eq(schema.prospectRequirements.contactId, contact.id));
        assert.equal(perfil1.operation, "alquiler");
        assert.equal(perfil1.urgency, "ya");
        assert.deepEqual(perfil1.zones, ["Pichincha"]);
        assert.equal(Number(perfil1.priceMax), 60000);
        assert.equal(perfil1.currency, "ARS");

        const [c1] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, contact.id));
        assert.equal(c1.temperature, "tibio", "la temperatura va en el contacto, no en la conversación");

        // ── Segundo mensaje: incremental, no pisa lo anterior ──
        // "sí, dale" no dice nada nuevo: no puede borrar zona ni presupuesto.
        await applyTags({
          organizationId: org.id,
          contactId: contact.id,
          conversationId: conv.id,
          decisions: {
            operation: null,
            propertyType: null,
            urgency: null,
            paymentMethod: null,
            temperature: null,
            interestedInShownProperty: 0,
          },
          extracted: {},
        });

        const [perfil2] = await tx
          .select()
          .from(schema.prospectRequirements)
          .where(eq(schema.prospectRequirements.contactId, contact.id));
        assert.equal(perfil2.id, perfil1.id, "actualiza el mismo perfil, no crea otro");
        assert.equal(perfil2.operation, "alquiler", "un mensaje sin datos no borra la operación");
        assert.deepEqual(perfil2.zones, ["Pichincha"], "ni la zona");
        assert.equal(Number(perfil2.priceMax), 60000, "ni el presupuesto");

        const [c2] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, contact.id));
        assert.equal(c2.temperature, "tibio", "la temperatura tampoco se degrada sola");

        // ── Tercer mensaje: agrega una zona y sube la temperatura ──
        await applyTags({
          organizationId: org.id,
          contactId: contact.id,
          conversationId: conv.id,
          decisions: {
            operation: null,
            propertyType: null,
            urgency: null,
            paymentMethod: "credito",
            temperature: "caliente",
            interestedInShownProperty: 0.9,
          },
          extracted: { zonas: ["Centro"], tipo_credito: "bancario" },
        });

        const [perfil3] = await tx
          .select()
          .from(schema.prospectRequirements)
          .where(eq(schema.prospectRequirements.contactId, contact.id));
        assert.deepEqual(perfil3.zones, ["Pichincha", "Centro"], "las zonas se acumulan, no se reemplazan");
        assert.equal(perfil3.paymentMethod, "credito");
        assert.equal(perfil3.creditType, "bancario");

        const [c3] = await tx.select().from(schema.contacts).where(eq(schema.contacts.id, contact.id));
        assert.equal(c3.temperature, "caliente");

        // ── Interés por propiedad ──
        const [property] = await tx
          .insert(schema.properties)
          .values({
            organizationId: org.id,
            operation: "alquiler",
            propertyType: "departamento",
            status: "disponible",
            title: "Depto Pichincha",
            zone: "Pichincha",
          })
          .returning();

        const [deal] = await tx
          .insert(schema.deals)
          .values({
            organizationId: org.id,
            contactId: contact.id,
            title: "Juan - alquiler",
            prospectRequirementId: perfil3.id,
          })
          .returning();
        await tx
          .insert(schema.dealProperties)
          .values({ organizationId: org.id, dealId: deal.id, propertyId: property.id });

        const marcadas = await markPropertyInterest({
          organizationId: org.id,
          contactId: contact.id,
          temperature: "caliente",
        });
        assert.equal(marcadas, 1);

        const interesados = await listPropertyInterest(property.id, org.id);
        assert.equal(interesados.length, 1);
        assert.equal(interesados[0].interest, "caliente");
        assert.equal(interesados[0].temperature, "caliente");
        assert.equal(interesados[0].priceMax, 60000, "el presupuesto sale del perfil del contacto");
        assert.equal(interesados[0].currency, "ARS");
        assert.equal(interesados[0].urgency, "ya");

        // Aislamiento: otra inmobiliaria no ve nada de esto.
        assert.equal((await listPropertyInterest(property.id, otra.id)).length, 0);
        assert.equal(
          await markPropertyInterest({ organizationId: otra.id, contactId: contact.id, temperature: "frio" }),
          0,
          "no se puede marcar interés desde otra inmobiliaria",
        );

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }

    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("tags: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
