import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { propertySyncConfigs } from "@/db/schema";
import { safeError } from "@/lib/safe-error";
import { analyzeRows, type Analysis } from "./analyze";
import { parseSpreadsheetRef, readSheet } from "./client";

// Fuente de propiedades de una inmobiliaria (la hoja de Google). Cambiarla es una operación con
// consecuencias: lo que no está en la hoja nueva se PAUSA (el bot deja de ofrecerlo). Por eso:
//   1. se valida ANTES de guardar: que se pueda leer, que tenga las columnas obligatorias y filas importables;
//   2. al guardar se sincroniza en el acto: el bot no queda consultando la cartera de la hoja anterior.
// El enlace para abrirla es el de Google: Google aplica sus permisos. Nunca lleva credenciales, y una
// hoja privada NO se vuelve pública por abrirla desde acá.

export type SheetSource = {
  spreadsheetId: string;
  gid: string | null;
  openUrl: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
  lastRowsSeen: number | null;
  lastRowsUpserted: number | null;
};

export const sheetOpenUrl = (spreadsheetId: string, gid: string | null) =>
  `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit${gid ? `#gid=${encodeURIComponent(gid)}` : ""}`;

export async function getSheetSource(orgId: string): Promise<SheetSource | null> {
  const [c] = await getDb().select().from(propertySyncConfigs).where(eq(propertySyncConfigs.organizationId, orgId));
  if (!c) return null;
  return {
    spreadsheetId: c.spreadsheetId,
    gid: c.sheetGid,
    openUrl: sheetOpenUrl(c.spreadsheetId, c.sheetGid),
    enabled: c.enabled,
    lastRunAt: c.lastRunAt,
    lastStatus: c.lastStatus,
    lastError: c.lastError,
    lastRowsSeen: c.lastRowsSeen,
    lastRowsUpserted: c.lastRowsUpserted,
  };
}

export type SourceCheck =
  | { ok: true; spreadsheetId: string; gid: string | null; analysis: Analysis; mode: string; blockers: string[] }
  | { ok: false; error: string };

/** Lee y analiza una hoja candidata SIN escribir nada. `blockers` vacío = se puede guardar. */
export async function checkSheetSource(raw: string): Promise<SourceCheck> {
  const ref = parseSpreadsheetRef(raw);
  if (!ref) return { ok: false, error: "Pegá la URL de la hoja de Google o su identificador." };
  try {
    const sheet = await readSheet(ref.spreadsheetId, ref.gid);
    if (!sheet.success) return { ok: false, error: sheet.error };
    if (!sheet.rows.length) return { ok: false, error: "La hoja está vacía." };
    const analysis = analyzeRows(sheet.rows);
    const blockers: string[] = [];
    for (const m of analysis.missing) if (m.level === "obligatoria") blockers.push(`Falta la columna obligatoria «${m.label}». ${m.hint}`);
    // Sin filas importables, sincronizar pausaría TODA la cartera actual: no se permite.
    if (analysis.counts.importable === 0) blockers.push("Ninguna fila se puede importar (revisá identificador y operación).");
    return { ok: true, spreadsheetId: ref.spreadsheetId, gid: ref.gid, analysis, mode: sheet.mode, blockers };
  } catch (err) {
    return { ok: false, error: safeError(err) };
  }
}

/** Guarda la hoja como fuente (después de un check sin bloqueos). Devuelve si cambió respecto de la anterior. */
export async function saveSheetSource(orgId: string, spreadsheetId: string, gid: string | null): Promise<{ changed: boolean }> {
  const before = await getSheetSource(orgId);
  await getDb()
    .insert(propertySyncConfigs)
    .values({ organizationId: orgId, spreadsheetId, sheetGid: gid, enabled: true })
    .onConflictDoUpdate({
      target: propertySyncConfigs.organizationId,
      set: { spreadsheetId, sheetGid: gid, enabled: true, updatedAt: sql`now()` },
    });
  return { changed: !before || before.spreadsheetId !== spreadsheetId || (before.gid ?? null) !== (gid ?? null) };
}
