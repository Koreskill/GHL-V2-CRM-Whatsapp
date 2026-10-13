import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { properties, propertySyncConfigs } from "@/db/schema";
import { reportIncident, resolveIncidents } from "@/lib/incidents/report";
import { safeError } from "@/lib/safe-error";
import { readSheet } from "./client";
import { mediaFromDescription } from "@/lib/properties/media";
import {
  date, inferOperation, int, list, mapHeader, needsReview, num, parseOperation, parseStatus, parseType, resolvePrice, url, urlFromFormula, urlList,
  type Field,
} from "./columns";

export type SyncResult = {
  ok: boolean;
  rowsSeen: number;
  upserted: number;
  skipped: number;
  issues: string[];
  error?: string;
  mode?: string;
  /** Cómo se leyó el encabezado: qué columna se tomó para cada campo y cuáles no se usaron. */
  columns?: { recognized: { header: string; field: string; how: string }[]; unrecognized: string[] };
};

/**
 * Trae la hoja y refleja la cartera en el CRM.
 *
 * - `property_id` es la clave estable: la misma propiedad se actualiza aunque cambien título o precio.
 * - Una propiedad que desaparece de la hoja NO se borra: se pausa, para conservar su historial
 *   (oportunidades y visitas siguen apuntando a ella).
 * - Lo que falta se registra en `sync_issues` y la ficha lo señala. Nunca se inventa un dato.
 */
export async function syncPropertiesFromSheet(orgId: string): Promise<SyncResult> {
  const db = getDb();
  const [config] = await db
    .select()
    .from(propertySyncConfigs)
    .where(eq(propertySyncConfigs.organizationId, orgId));

  if (!config) return { ok: false, rowsSeen: 0, upserted: 0, skipped: 0, issues: [], error: "Sin hoja configurada" };
  if (!config.enabled) {
    return { ok: false, rowsSeen: 0, upserted: 0, skipped: 0, issues: [], error: "La sincronización está apagada" };
  }

  const markRun = (result: SyncResult) =>
    db
      .update(propertySyncConfigs)
      .set({
        lastRunAt: new Date(),
        lastStatus: result.ok ? "ok" : "error",
        lastError: result.error ?? null,
        lastRowsSeen: result.rowsSeen,
        lastRowsUpserted: result.upserted,
        lastRowsSkipped: result.skipped,
      })
      .where(eq(propertySyncConfigs.organizationId, orgId))
      .catch(() => {});

  const sheet = await readSheet(config.spreadsheetId, config.sheetGid);
  if (!sheet.success) {
    const result: SyncResult = { ok: false, rowsSeen: 0, upserted: 0, skipped: 0, issues: [], error: sheet.error };
    await markRun(result);
    await reportIncident({
      organizationId: orgId,
      module: "sheets",
      key: "lectura",
      message: `No se pudo leer la hoja de propiedades: ${sheet.error}`,
      retryTarget: "sheets:sync",
      context: { spreadsheetId: config.spreadsheetId },
    });
    return result;
  }

  const [header, ...rows] = sheet.rows;
  if (!header) {
    const result: SyncResult = {
      ok: false,
      rowsSeen: 0,
      upserted: 0,
      skipped: 0,
      issues: [],
      error: "La hoja está vacía",
    };
    await markRun(result);
    return result;
  }

  const mapping = mapHeader(header);
  const index = mapping.index;
  if (index.externalId === undefined) {
    const result: SyncResult = {
      ok: false,
      rowsSeen: rows.length,
      upserted: 0,
      skipped: rows.length,
      issues: [],
      error: `Falta la columna property_id, que es la que identifica cada propiedad. Columnas que encontré: ${header.filter((h) => h.trim()).join(", ")}`,
    };
    await markRun(result);
    await reportIncident({
      organizationId: orgId,
      module: "sheets",
      key: "sin-property-id",
      message: "La hoja no tiene columna property_id: sin ella no se puede identificar cada propiedad",
      retryTarget: "sheets:sync",
    });
    return result;
  }

  const cell = (row: string[], field: Field) => {
    const i = index[field];
    return i === undefined ? undefined : row[i]?.trim() || undefined;
  };
  // Todas las celdas de una fila por nombre de campo (para el precio y la operación).
  const cells = (row: string[]) => Object.fromEntries((Object.keys(index) as Field[]).map((f) => [f, cell(row, f)])) as Partial<Record<Field, string | undefined>>;

  const issues: string[] = [];
  // Columnas importantes que la hoja no trae: se avisa UNA vez, no en cada fila.
  const hasPrice = ["price", "priceSale", "priceRent"].some((f) => index[f as Field] !== undefined);
  if (index.operation === undefined && !(index.priceSale !== undefined && index.priceRent !== undefined)) {
    issues.push("La hoja no tiene columna de operación (operation_type u operación): cada fila se deduce solo si tiene un único precio");
  }
  if (!hasPrice) issues.push("La hoja no tiene ninguna columna de precio (price_sale_amount, price_rent_amount o precio)");
  if (index.title === undefined) issues.push("La hoja no tiene columna de título (listing_title o título)");
  const seenIds = new Set<string>();
  let upserted = 0;
  let skipped = 0;
  let protegidas = 0;

  // Propiedades que alguien editó a mano: la sincronización NO las pisa, hasta que se pida
  // explícitamente volver a tomarlas de la fuente (que limpia manually_edited_at).
  const editadasAMano = new Set(
    (
      await db
        .select({ externalId: properties.externalId })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, orgId),
            eq(properties.source, "google_sheets"),
            isNotNull(properties.manuallyEditedAt),
            isNotNull(properties.externalId),
          ),
        )
    ).map((r) => r.externalId as string),
  );

  for (const [n, row] of rows.entries()) {
    const line = n + 2; // +1 por el encabezado, +1 porque las filas de la hoja arrancan en 1
    const externalId = cell(row, "externalId");
    if (!externalId) {
      skipped++;
      // Una fila totalmente vacía al final de la hoja no es un error.
      if (row.some((v) => v.trim())) issues.push(`Fila ${line}: sin property_id, se omitió`);
      continue;
    }
    if (seenIds.has(externalId)) {
      skipped++;
      issues.push(`Fila ${line}: property_id "${externalId}" duplicado, se omitió`);
      continue;
    }
    seenIds.add(externalId);

    // Editada a mano: se respeta lo que puso la persona. Se cuenta aparte, no como omitida
    // por error, porque no es un problema de la hoja.
    if (editadasAMano.has(externalId)) {
      protegidas++;
      continue;
    }

    // Qué le falta a ESTA propiedad. Se guarda con ella para que la ficha lo señale.
    const rowIssues: string[] = [];

    // La operación sale de su columna; si la hoja no la trae, solo se deduce cuando hay UN precio posible.
    const operationRaw = cell(row, "operation");
    const operation = operationRaw ? parseOperation(operationRaw) : inferOperation(cells(row));
    if (!operation) {
      skipped++;
      issues.push(
        operationRaw
          ? /venta/i.test(operationRaw) && /alquiler|renta|rent/i.test(operationRaw)
            ? `Fila ${line}: operación "${operationRaw}": ofrece venta Y alquiler y el CRM maneja una operación por propiedad; elegí una en la hoja`
            : `Fila ${line}: operación "${operationRaw}" no reconocida (venta, alquiler o temporario)`
          : `Fila ${line}: sin operación y no se puede deducir (hay precio de venta y de alquiler, o ninguno)`,
      );
      continue;
    }

    const typeRaw = cell(row, "propertyType");
    const parsedType = parseType(typeRaw);
    const propertyType = (parsedType ?? "otro") as "otro";
    if (!parsedType) rowIssues.push(typeRaw ? `Tipo de inmueble "${typeRaw}" no reconocido, quedó como «otro»` : "Sin tipo de inmueble, quedó como «otro»");

    const statusRaw = cell(row, "status");
    const parsedStatus = parseStatus(statusRaw);
    const status = (parsedStatus ?? "disponible") as "disponible";
    if (statusRaw && !parsedStatus) rowIssues.push(`Estado "${statusRaw}" no reconocido, se tomó como disponible`);
    if (needsReview(statusRaw)) rowIssues.push("La hoja la marcó para revisar");

    // Precio: el de venta o el de alquiler según la operación de esta fila.
    const priced = resolvePrice(operation, cells(row));
    if (!priced.price) rowIssues.push("Sin precio");
    if (priced.note) rowIssues.push(priced.note);
    if (priced.price && !priced.currency) rowIssues.push("Moneda sin indicar: se asumió USD");

    // Portada: su columna, o el enlace de la vista previa si la hoja solo trae esa.
    const coverUrl = url(cell(row, "coverUrl")) ?? urlFromFormula(cell(row, "coverUrl")) ?? urlFromFormula(cell(row, "coverPreview"));
    if (cell(row, "coverUrl") && !coverUrl) rowIssues.push("La portada no es un enlace válido");
    if (!cell(row, "coverUrl") && !coverUrl) rowIssues.push("Sin portada");
    if (!cell(row, "title")) rowIssues.push("Sin título");

    // La hoja marca por sí misma qué dato no es confiable: se muestra tal cual en la ficha.
    const quality = cell(row, "qualityNote");
    if (quality) rowIssues.push(`Nota de calidad de la hoja: ${quality.slice(0, 200)}`);

    // Enlaces escritos en la descripción: completan las columnas vacías, nunca las pisan.
    const fromText = mediaFromDescription(cell(row, "description"));

    // Lo que no tiene columna propia en el modelo va en features, con el nombre que la ficha entiende.
    const extra: Record<string, unknown> = {};
    const put = (key: string, value: unknown) => {
      if (value !== null && value !== undefined && value !== "") extra[key] = value;
    };
    put("ambientes", int(cell(row, "rooms")));
    put("toilettes", int(cell(row, "toilettes")));
    put("terreno_m2", num(cell(row, "landAreaM2")));
    put("semicubierta_m2", num(cell(row, "areaSemiCoveredM2")));
    put("superficie_texto", cell(row, "areaRaw"));
    put("superficie_tipo", cell(row, "areaKind"));
    put("precio_texto", cell(row, "priceSourceText"));

    const values = {
      organizationId: orgId,
      externalId,
      source: "google_sheets",
      operation,
      propertyType,
      status,
      title: cell(row, "title") ?? null,
      description: cell(row, "description") ?? null,
      price: priced.price,
      currency: priced.currency ?? "USD",
      addressPublic: cell(row, "addressPublic") ?? null,
      zone: cell(row, "zone") ?? null,
      city: cell(row, "city") ?? null,
      mapUrl: url(cell(row, "mapUrl")),
      areaM2: num(cell(row, "areaM2")),
      areaCoveredM2: num(cell(row, "areaCoveredM2")),
      bedrooms: int(cell(row, "bedrooms")),
      bathrooms: int(cell(row, "bathrooms")),
      parking: int(cell(row, "parking")),
      amenities: list(cell(row, "amenities")),
      coverUrl,
      galleryUrls: urlList(cell(row, "galleryUrls")).length ? urlList(cell(row, "galleryUrls")) : fromText.fotos,
      videoUrl: url(cell(row, "videoUrl")) ?? fromText.video,
      tour360Url: url(cell(row, "tour360Url")) ?? fromText.tour,
      sourceUrl: url(cell(row, "sourceUrl")) ?? fromText.ficha,
      internalNotes: cell(row, "internalNotes") ?? null,
      externalUpdatedAt: date(cell(row, "externalUpdatedAt")),
      syncedAt: new Date(),
      syncStatus: rowIssues.length ? "error" : "ok",
      syncIssues: rowIssues,
      features: extra,
    };

    await db
      .insert(properties)
      .values(values)
      .onConflictDoUpdate({
        target: [properties.organizationId, properties.externalId],
        // El índice único es PARCIAL (where external_id is not null): el ON CONFLICT tiene que
        // declarar la misma condición o Postgres no lo reconoce.
        targetWhere: sql`${properties.externalId} is not null`,
        set: {
          operation: values.operation,
          propertyType: values.propertyType,
          status: values.status,
          title: values.title,
          description: values.description,
          price: values.price,
          currency: values.currency,
          addressPublic: values.addressPublic,
          zone: values.zone,
          city: values.city,
          mapUrl: values.mapUrl,
          areaM2: values.areaM2,
          areaCoveredM2: values.areaCoveredM2,
          bedrooms: values.bedrooms,
          bathrooms: values.bathrooms,
          parking: values.parking,
          amenities: values.amenities,
          coverUrl: values.coverUrl,
          galleryUrls: values.galleryUrls,
          videoUrl: values.videoUrl,
          tour360Url: values.tour360Url,
          sourceUrl: values.sourceUrl,
          internalNotes: values.internalNotes,
          externalUpdatedAt: values.externalUpdatedAt,
          syncedAt: values.syncedAt,
          syncStatus: values.syncStatus,
          syncIssues: values.syncIssues,
          features: values.features,
          updatedAt: sql`now()`,
        },
      });
    upserted++;
  }

  // Lo que ya no está en la hoja se PAUSA, no se borra: su historial (oportunidades, visitas)
  // tiene que seguir existiendo.
  const ids = [...seenIds];
  const paused = await db
    .update(properties)
    .set({ status: "pausada", syncedAt: new Date() })
    .where(
      and(
        eq(properties.organizationId, orgId),
        eq(properties.source, "google_sheets"),
        ids.length ? notInArray(properties.externalId, ids) : sql`true`,
        notInArray(properties.status, ["pausada"]),
        // Una propiedad editada a mano tampoco se pausa sola.
        isNull(properties.manuallyEditedAt),
      ),
    )
    .returning({ id: properties.id });
  if (paused.length) issues.push(`${paused.length} propiedad(es) ya no están en la hoja: quedaron pausadas`);
  if (protegidas) {
    issues.push(
      `${protegidas} propiedad(es) editadas a mano no se tocaron. Para volver a tomarlas de la hoja, abrí su ficha y usá «Volver a sincronizar».`,
    );
  }

  const result: SyncResult = {
    ok: true,
    rowsSeen: rows.length,
    upserted,
    skipped,
    issues,
    mode: sheet.mode,
    columns: { recognized: mapping.recognized, unrecognized: mapping.unrecognized },
  };
  await markRun(result);

  // Si hubo filas con problemas queda un aviso; si salió todo bien se cierra el anterior.
  if (issues.length) {
    await reportIncident({
      organizationId: orgId,
      module: "sheets",
      key: "filas",
      severity: "advertencia",
      message: `La sincronización terminó con ${issues.length} aviso(s) en la hoja de propiedades`,
      retryTarget: "sheets:sync",
      context: { issues: issues.slice(0, 20) },
    });
  } else {
    await resolveIncidents(orgId, "sheets", "filas");
  }
  await resolveIncidents(orgId, "sheets", "lectura");

  return result;
}

// Sincroniza todas las inmobiliarias con hoja activa (barrido programado).
export async function syncAllOrganizations(): Promise<{ orgId: string; result: SyncResult }[]> {
  const configs = await getDb()
    .select({ organizationId: propertySyncConfigs.organizationId })
    .from(propertySyncConfigs)
    .where(eq(propertySyncConfigs.enabled, true));

  const out: { orgId: string; result: SyncResult }[] = [];
  for (const c of configs) {
    try {
      out.push({ orgId: c.organizationId, result: await syncPropertiesFromSheet(c.organizationId) });
    } catch (error) {
      out.push({
        orgId: c.organizationId,
        result: { ok: false, rowsSeen: 0, upserted: 0, skipped: 0, issues: [], error: safeError(error) },
      });
    }
  }
  return out;
}

