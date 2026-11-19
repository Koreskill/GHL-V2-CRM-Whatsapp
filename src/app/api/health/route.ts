import { sql } from "drizzle-orm";
import { getRootDb } from "@/db";
import journal from "../../../../drizzle/meta/_journal.json";

export const dynamic = "force-dynamic";

// Migraciones que este código espera (el journal viaja dentro del build).
const EXPECTED = (journal as { entries: { tag: string }[] }).entries.length;
const LATEST = (journal as { entries: { tag: string }[] }).entries.at(-1)?.tag ?? null;

// Readiness para Dokploy/Traefik: el proceso vive, la base contesta y la base tiene todas las migraciones
// que el código necesita. Un despliegue con una migración sin aplicar rompe consultas enteras (p. ej. la
// bandeja): acá se ve ANTES, con 503. Sin datos sensibles.
export async function GET() {
  const started = Date.now();
  const version = process.env.SOURCE_COMMIT ?? process.env.GIT_COMMIT ?? "desconocida";
  try {
    await getRootDb().execute(sql`select 1`);
  } catch {
    return Response.json({ ok: false, db: "error", version }, { status: 503 });
  }

  // El rol de la app puede no tener permiso de lectura sobre el esquema drizzle: entonces "desconocido",
  // que NO tumba el health (darle GRANT SELECT ON drizzle.__drizzle_migrations TO crm_app lo habilita).
  let migrations: { applied: number | null; expected: number; latest: string | null; status: "ok" | "pendientes" | "desconocido" };
  try {
    const [row] = await getRootDb().execute<{ n: number }>(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    const applied = row?.n ?? 0;
    migrations = { applied, expected: EXPECTED, latest: LATEST, status: applied >= EXPECTED ? "ok" : "pendientes" };
  } catch {
    migrations = { applied: null, expected: EXPECTED, latest: LATEST, status: "desconocido" };
  }

  const ok = migrations.status !== "pendientes";
  return Response.json({ ok, db: "ok", migrations, ms: Date.now() - started, version }, { status: ok ? 200 : 503 });
}
