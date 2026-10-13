import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { propertySyncConfigs } from "@/db/schema";
import { safeError } from "@/lib/safe-error";
import { analyzeRows, type Analysis } from "./analyze";
import { readSheet } from "./client";

export type AnalyzeState = { ok: true; analysis: Analysis; mode: string } | { ok: false; error: string } | null;

/** Lee la hoja de la inmobiliaria y la analiza SIN escribir nada en la cartera. */
export async function analyzeOrgSheet(orgId: string): Promise<Exclude<AnalyzeState, null>> {
  try {
    const [config] = await getDb().select().from(propertySyncConfigs).where(eq(propertySyncConfigs.organizationId, orgId));
    if (!config) return { ok: false, error: "Todavía no hay una hoja conectada." };
    const sheet = await readSheet(config.spreadsheetId, config.sheetGid);
    if (!sheet.success) return { ok: false, error: sheet.error };
    if (!sheet.rows.length) return { ok: false, error: "La hoja está vacía." };
    return { ok: true, analysis: analyzeRows(sheet.rows), mode: sheet.mode };
  } catch (err) {
    return { ok: false, error: safeError(err) };
  }
}
