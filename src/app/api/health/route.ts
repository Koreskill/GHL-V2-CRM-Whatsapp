import { sql } from "drizzle-orm";
import { getRootDb } from "@/db";

export const dynamic = "force-dynamic";

// Readiness para Dokploy/Traefik: responde si el proceso vive y la base contesta. Sin datos sensibles.
export async function GET() {
  const started = Date.now();
  try {
    await getRootDb().execute(sql`select 1`);
    return Response.json({ ok: true, db: "ok", ms: Date.now() - started, version: process.env.SOURCE_COMMIT ?? process.env.GIT_COMMIT ?? "desconocida" });
  } catch {
    return Response.json({ ok: false, db: "error" }, { status: 503 });
  }
}
