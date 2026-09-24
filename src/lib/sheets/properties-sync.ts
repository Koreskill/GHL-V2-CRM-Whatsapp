import { and, eq, isNotNull, isNull, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { properties, propertySyncConfigs } from "@/db/schema";
import { reportIncident, resolveIncidents } from "@/lib/incidents/report";
import { safeError } from "@/lib/safe-error";
import { readSheet } from "./client";

// ─── Mapeo de columnas ──────────────────────────────────────────────────────
// Se reconoce el encabezado por varios nombres posibles, sin acentos ni mayúsculas, para que la
// hoja no tenga que escribirse exactamente igual. Lo que no se reconoce se ignora: el sistema
// NO completa características por su cuenta.
const COLUMNS: Record<string, string[]> = {
  externalId: ["property_id", "id", "id propiedad", "codigo", "código"],
  title: ["titulo", "título", "nombre"],
  status: ["estado", "disponibilidad"],
  operation: ["operacion", "operación", "venta o alquiler", "tipo de operacion"],
  propertyType: ["tipo de inmueble", "tipo", "tipo inmueble"],
  price: ["precio", "valor"],
  currency: ["moneda"],
  addressPublic: ["direccion publicable", "dirección publicable", "direccion", "dirección"],
  zone: ["barrio", "zona"],
  city: ["ciudad", "localidad"],
  mapUrl: ["ubicacion", "ubicación", "mapa", "ubicacion/mapa", "ubicación/mapa"],
  areaM2: ["superficie total", "superficie", "sup total", "m2", "metros"],
  areaCoveredM2: ["superficie cubierta", "sup cubierta", "m2 cubiertos"],
  rooms: ["ambientes"],
  bedrooms: ["dormitorios", "habitaciones"],
  bathrooms: ["banos", "baños"],
  parking: ["cocheras", "cochera", "garage", "garajes"],
  amenities: ["amenities", "comodidades"],
  description: ["descripcion", "descripción"],
  coverUrl: ["url de portada", "portada", "url portada", "imagen principal"],
  galleryUrls: ["urls de galeria", "urls de galería", "galeria", "galería", "fotos", "imagenes", "imágenes"],
  videoUrl: ["url de video", "video", "url video"],
  tour360Url: ["url de tour 360", "tour 360", "tour360", "url tour 360", "tour virtual"],
  externalUpdatedAt: ["fecha de actualizacion", "fecha de actualización", "actualizado", "ultima actualizacion"],
  sourceUrl: ["enlace original", "link original", "url original", "enlace"],
  internalNotes: ["observaciones internas", "observaciones", "notas internas"],
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

function mapHeader(header: string[]): Record<string, number> {
  const index: Record<string, number> = {};
  header.forEach((raw, i) => {
    const name = normalize(raw);
    for (const [field, aliases] of Object.entries(COLUMNS)) {
      if (index[field] === undefined && aliases.some((a) => normalize(a) === name)) index[field] = i;
    }
  });
  return index;
}

// ─── Normalización de valores ───────────────────────────────────────────────

const OPERATIONS: Record<string, "venta" | "alquiler" | "temporario"> = {
  venta: "venta",
  vender: "venta",
  alquiler: "alquiler",
  alquilar: "alquiler",
  renta: "alquiler",
  temporario: "temporario",
  temporal: "temporario",
};

const TYPES: Record<string, string> = {
  departamento: "departamento",
  depto: "departamento",
  casa: "casa",
  ph: "ph",
  terreno: "terreno",
  lote: "terreno",
  local: "local",
  oficina: "oficina",
  cochera: "cochera",
};

const STATUSES: Record<string, string> = {
  borrador: "borrador",
  disponible: "disponible",
  activa: "disponible",
  activo: "disponible",
  reservada: "reservada",
  reservado: "reservada",
  vendida: "vendida",
  vendido: "vendida",
  alquilada: "alquilada",
  alquilado: "alquilada",
  pausada: "pausada",
  pausado: "pausada",
};

function num(value: string | undefined): string | null {
  if (!value) return null;
  // Tolera "USD 120.000", "120,000" y "1.250,50".
  const cleaned = value.replace(/[^\d.,-]/g, "");
  if (!cleaned) return null;
  const normalized =
    cleaned.includes(",") && cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? String(n) : null;
}

const int = (value: string | undefined): number | null => {
  const n = num(value);
  return n === null ? null : Math.round(Number(n));
};

// Solo se aceptan URLs http(s): una celda con una imagen pegada adentro no sirve, y un
// javascript:/data: no tiene por qué terminar en el navegador de nadie.
function url(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const urlList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[\n,;|]/)
    .map((v) => url(v))
    .filter((v): v is string => v !== null);

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(/[\n,;|]/)
    .map((v) => v.trim())
    .filter(Boolean);

function date(value: string | undefined): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  // dd/mm/aaaa es lo habitual en una hoja en castellano; Date lo leería como mm/dd.
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  const parsed = dmy ? new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])) : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export type SyncResult = {
  ok: boolean;
  rowsSeen: number;
  upserted: number;
  skipped: number;
  issues: string[];
  error?: string;
  mode?: string;
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

  const index = mapHeader(header);
  if (index.externalId === undefined) {
    const result: SyncResult = {
      ok: false,
      rowsSeen: rows.length,
      upserted: 0,
      skipped: rows.length,
      issues: [],
      error: "Falta la columna property_id, que es la que identifica cada propiedad",
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

  const cell = (row: string[], field: string) => {
    const i = index[field];
    return i === undefined ? undefined : row[i]?.trim() || undefined;
  };

  const issues: string[] = [];
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

    const operationRaw = normalize(cell(row, "operation") ?? "");
    const operation = OPERATIONS[operationRaw];
    if (!operation) {
      skipped++;
      issues.push(`Fila ${line}: operación "${cell(row, "operation") ?? ""}" no reconocida (venta o alquiler)`);
      continue;
    }

    const typeRaw = normalize(cell(row, "propertyType") ?? "");
    const propertyType = (TYPES[typeRaw] ?? "otro") as "otro";
    if (!TYPES[typeRaw]) rowIssues.push("Tipo de inmueble no reconocido, quedó como «otro»");

    const statusRaw = normalize(cell(row, "status") ?? "");
    const status = (STATUSES[statusRaw] ?? "disponible") as "disponible";
    if (statusRaw && !STATUSES[statusRaw]) rowIssues.push(`Estado "${cell(row, "status")}" no reconocido`);

    const price = num(cell(row, "price"));
    if (!price) rowIssues.push("Sin precio");
    const coverUrl = url(cell(row, "coverUrl"));
    if (cell(row, "coverUrl") && !coverUrl) rowIssues.push("La portada no es un enlace válido");
    if (!cell(row, "coverUrl")) rowIssues.push("Sin portada");
    if (!cell(row, "title")) rowIssues.push("Sin título");

    const values = {
      organizationId: orgId,
      externalId,
      source: "google_sheets",
      operation,
      propertyType,
      status,
      title: cell(row, "title") ?? null,
      description: cell(row, "description") ?? null,
      price,
      currency: (cell(row, "currency") ?? "USD").toUpperCase().slice(0, 8),
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
      galleryUrls: urlList(cell(row, "galleryUrls")),
      videoUrl: url(cell(row, "videoUrl")),
      tour360Url: url(cell(row, "tour360Url")),
      sourceUrl: url(cell(row, "sourceUrl")),
      internalNotes: cell(row, "internalNotes") ?? null,
      externalUpdatedAt: date(cell(row, "externalUpdatedAt")),
      syncedAt: new Date(),
      syncStatus: rowIssues.length ? "error" : "ok",
      syncIssues: rowIssues,
      // Los ambientes no tienen columna propia en el modelo: van en features.
      features: cell(row, "rooms") ? { ambientes: int(cell(row, "rooms")) } : {},
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

