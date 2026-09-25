import { config } from "dotenv";
import { and, eq, isNull, or, sql } from "drizzle-orm";

config({ path: ".env.local", quiet: true });

import { getDb } from "../src/db";
import { properties } from "../src/db/schema";
import { mediaFromDescription } from "../src/lib/properties/media";

/**
 * Completa source_url, video_url, tour_360_url y gallery_urls VACÍOS con los enlaces que la
 * inmobiliaria escribió en la descripción de cada propiedad.
 *
 * - Nunca pisa un valor cargado: solo escribe donde el campo está vacío.
 * - Es idempotente: correrlo dos veces no cambia nada la segunda.
 * - De ahora en más lo hace la sincronización sola; esto es para lo que ya estaba cargado.
 *
 *   npx tsx scripts/backfill-media.ts          (muestra qué cambiaría, no escribe)
 *   npx tsx scripts/backfill-media.ts --aplicar
 */

async function main() {
  const apply = process.argv.includes("--aplicar");
  const db = getDb();

  const rows = await db
    .select({
      id: properties.id,
      organizationId: properties.organizationId,
      externalId: properties.externalId,
      description: properties.description,
      sourceUrl: properties.sourceUrl,
      videoUrl: properties.videoUrl,
      tour360Url: properties.tour360Url,
      galleryUrls: properties.galleryUrls,
    })
    .from(properties)
    .where(
      or(
        isNull(properties.sourceUrl),
        isNull(properties.videoUrl),
        isNull(properties.tour360Url),
        sql`jsonb_array_length(${properties.galleryUrls}) = 0`,
      ),
    );

  let changed = 0;
  for (const r of rows) {
    const m = mediaFromDescription(r.description);
    const patch: Record<string, unknown> = {};
    if (!r.sourceUrl && m.ficha) patch.sourceUrl = m.ficha;
    if (!r.videoUrl && m.video) patch.videoUrl = m.video;
    if (!r.tour360Url && m.tour) patch.tour360Url = m.tour;
    if (!r.galleryUrls.length && m.fotos.length) patch.galleryUrls = m.fotos;
    if (!Object.keys(patch).length) continue;

    changed++;
    console.log(`#${r.externalId ?? r.id.slice(0, 8)}: ${Object.keys(patch).join(", ")}`);
    if (apply) {
      await db
        .update(properties)
        // Filtra por organización también: nunca se escribe fuera del tenant de la fila.
        .set(patch)
        .where(and(eq(properties.id, r.id), eq(properties.organizationId, r.organizationId)));
    }
  }

  console.log(`\n${changed} propiedades ${apply ? "actualizadas" : "se actualizarían (usá --aplicar)"}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
