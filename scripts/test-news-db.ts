import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { getVisibleEvent, listVisibleEvents } from "../src/lib/news/queries";
import type { Viewer } from "../src/lib/news/logic";

// Novedades contra la base REAL (rol crm_app): que las condiciones SQL de visibilidad coincidan con
// la regla y que el aislamiento entre clientes se sostenga. Requiere la migración 0017.
const dbState = globalThis as unknown as { db?: Db };
const rollback = new Error("news_test_rollback");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  const client = postgres(url, { prepare: false });
  const db = drizzle({ client, schema });
  const previousDb = dbState.db;
  const slug = `prueba-novedades-${randomUUID()}`;
  let checked = false;

  try {
    try {
      await db.transaction(async (tx) => {
        dbState.db = tx as Db;
        const [orgA, orgB] = await tx.insert(schema.organizations).values([{ name: "Cliente A", slug: `${slug}-a` }, { name: "Cliente B", slug: `${slug}-b` }]).returning();
        const [red, otraRed] = await tx.insert(schema.networks).values([{ name: "Red de prueba", slug: `${slug}-r1` }, { name: "Otra red", slug: `${slug}-r2` }]).returning();
        const user = randomUUID();
        const when = new Date(Date.now() + 2 * 86_400_000);
        const mk = (title: string, v: Partial<typeof schema.newsEvents.$inferInsert>) =>
          tx.insert(schema.newsEvents).values({ title, scope: "network", startAt: when, createdBy: user, eventType: "announcement", ...v }).returning().then((r) => r[0]);

        await mk("de la red", { scope: "network", networkId: red.id });
        const eOtraRed = await mk("de otra red", { scope: "network", networkId: otraRed.id });
        const eInterno = await mk("interno", { scope: "internal" });
        const eA = await mk("cliente A", { scope: "client", organizationId: orgA.id });
        const eB = await mk("cliente B", { scope: "client", organizationId: orgB.id });

        // La base misma rechaza un destino que no corresponde al alcance.
        await assert.rejects(() => tx.transaction(async (sp) => { await sp.insert(schema.newsEvents).values({ title: "mal", scope: "network", startAt: when, createdBy: user }); }), "una red sin red no se guarda");
        await assert.rejects(() => tx.transaction(async (sp) => { await sp.insert(schema.newsEvents).values({ title: "mal", scope: "internal", organizationId: orgA.id, startAt: when, createdBy: user }); }), "un interno con cliente no se guarda");

        const from = new Date();
        const to = new Date(Date.now() + 10 * 86_400_000);
        const titles = async (v: Viewer) => (await listVisibleEvents(v, from, to)).map((e) => e.title).sort();

        const miembro: Viewer = { isAgencyAdmin: false, acting: false, orgId: orgA.id, networkIds: [red.id] };
        const sinRed: Viewer = { isAgencyAdmin: false, acting: false, orgId: orgB.id, networkIds: [] };
        const agencia: Viewer = { isAgencyAdmin: true, acting: false, orgId: "home", networkIds: [red.id, otraRed.id] };
        const enClienteA: Viewer = { isAgencyAdmin: true, acting: true, orgId: orgA.id, networkIds: [red.id] };

        // 1. Un miembro de la red ve lo de su red y nada más.
        assert.deepEqual(await titles(miembro), ["de la red"]);
        // 2. El evento interno no llega a un usuario externo.
        assert.deepEqual(await titles(sinRed), []);
        assert.equal(await getVisibleEvent(miembro, eInterno.id), null);
        assert.equal(await getVisibleEvent(miembro, eA.id), null, "ni siquiera el de su propio cliente: es interno");
        assert.equal(await getVisibleEvent(miembro, eOtraRed.id), null);
        // 3. En el contexto del cliente A se ve lo de A, lo interno y las redes de A.
        assert.deepEqual(await titles(enClienteA), ["cliente A", "de la red", "interno"]);
        assert.ok(await getVisibleEvent(enClienteA, eA.id));
        // 4. Lo de otro cliente nunca se filtra.
        assert.equal(await getVisibleEvent(enClienteA, eB.id), null);
        assert.ok(!(await titles(enClienteA)).includes("cliente B"));
        assert.equal(await getVisibleEvent({ ...enClienteA, orgId: orgB.id }, eA.id), null);
        // La agencia, fuera de un cliente, ve todo; y puede acotar por cliente.
        assert.deepEqual(await titles(agencia), ["cliente A", "cliente B", "de la red", "de otra red", "interno"]);
        assert.deepEqual((await listVisibleEvents(agencia, from, to, { clientId: orgB.id })).map((e) => e.title), ["cliente B"]);
        // El filtro por cliente no hace nada para un usuario externo.
        assert.deepEqual((await listVisibleEvents(miembro, from, to, { clientId: orgB.id })).map((e) => e.title), ["de la red"]);
        // Filtros de alcance y de tipo.
        assert.deepEqual((await listVisibleEvents(agencia, from, to, { scope: "internal" })).map((e) => e.title), ["interno"]);

        checked = true;
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    assert.ok(checked, "el flujo llegó hasta el final");
    console.log("news-db: OK");
  } finally {
    dbState.db = previousDb;
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
