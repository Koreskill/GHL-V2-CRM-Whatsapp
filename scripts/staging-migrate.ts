// Aplica TODAS las migraciones (drizzle/) a una base de STAGING vacía y deja listo el rol crm_app.
// Uso: STAGING_OWNER_DATABASE_URL=postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres \
//      STAGING_CRM_APP_PASSWORD=... npx tsx scripts/staging-migrate.ts
// Usa la conexión del rol dueño (puerto 5432 / directa), NO la de crm_app. Se niega a correr contra producción.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const PRODUCTION_REF = "pryrsnqxhmpnolxlupna";

async function main() {
  const url = process.env.STAGING_OWNER_DATABASE_URL;
  const password = process.env.STAGING_CRM_APP_PASSWORD;
  if (!url || !password) throw new Error("Faltan STAGING_OWNER_DATABASE_URL y STAGING_CRM_APP_PASSWORD");
  if (url.includes(PRODUCTION_REF)) throw new Error("Esa URL es la de PRODUCCIÓN. Abortado.");
  if (password.length < 20 || !/^[A-Za-z0-9_.-]+$/.test(password)) throw new Error("La contraseña de crm_app debe tener 20+ caracteres: letras, números, guion, punto o guion bajo.");

  const client = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    // 0002 crea el rol sin contraseña: se la fija acá para que la app pueda conectarse.
    await client.unsafe(`ALTER ROLE crm_app PASSWORD '${password}'`);
    const [{ n }] = await client`select count(*)::int as n from drizzle.__drizzle_migrations`;
    console.log(`OK: ${n} migraciones registradas. crm_app listo.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("staging-migrate:", e instanceof Error ? e.message : e);
  process.exit(1);
});
