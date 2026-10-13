import assert from "node:assert/strict";
import { config } from "dotenv";
import { eq } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

import { getDb, getRootDb, runInSandbox } from "../src/db";
import { contacts } from "../src/db/schema";
import { DEFAULT_ORG_ID } from "../src/lib/tenancy";

// El Laboratorio escribe dentro de runInSandbox: nada puede quedar en la base, y una request concurrente
// (un webhook real) NO puede ver ni usar la transacción de pruebas.
async function main() {
  const name = `lab-sandbox-${Date.now()}`;
  let sawInside = 0;
  let sawOutsideDuring = -1;

  await runInSandbox(async () => {
    await getDb().insert(contacts).values({ organizationId: DEFAULT_ORG_ID, name });
    sawInside = (await getDb().select().from(contacts).where(eq(contacts.name, name))).length;
    // Otro contexto asíncrono (simula una request real) usa la conexión normal.
    sawOutsideDuring = await new Promise<number>((resolve) => {
      setImmediate(async () => resolve((await getRootDb().select().from(contacts).where(eq(contacts.name, name))).length));
    });
  });

  assert.equal(sawInside, 1, "dentro del sandbox se ve lo escrito");
  assert.equal(sawOutsideDuring, 0, "fuera del sandbox no se ve la transacción de pruebas");
  const after = await getRootDb().select().from(contacts).where(eq(contacts.name, name));
  assert.equal(after.length, 0, "el sandbox se revierte siempre");

  // Un error dentro también revierte y se propaga.
  await assert.rejects(
    runInSandbox(async () => {
      await getDb().insert(contacts).values({ organizationId: DEFAULT_ORG_ID, name: `${name}-err` });
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal((await getRootDb().select().from(contacts).where(eq(contacts.name, `${name}-err`))).length, 0);

  console.log("lab-sandbox: ok");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
