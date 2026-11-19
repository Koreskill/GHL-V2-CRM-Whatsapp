"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { writeAudit } from "@/lib/agency/queries";
import { checkSheetSource, saveSheetSource } from "@/lib/sheets/source";

// Cambiar la hoja de propiedades: solo admin de la inmobiliaria (o la agencia dentro de su espacio).
// Se vuelve a validar acá aunque la pantalla ya la haya probado: lo que manda es el servidor.
export async function saveSheetSourceAction(formData: FormData) {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const orgId = session.organizationId;
  const raw = String(formData.get("url") ?? "").trim().slice(0, 500);
  const back = (q: string): never => redirect(`/propiedades/fuente?${q}`);

  const check = await checkSheetSource(raw);
  if (!check.ok) back(`probar=${encodeURIComponent(raw)}&error=${encodeURIComponent(check.error)}`);
  const ok = check as Extract<typeof check, { ok: true }>;
  if (ok.blockers.length) back(`probar=${encodeURIComponent(raw)}&error=${encodeURIComponent(ok.blockers[0])}`);

  const { changed } = await saveSheetSource(orgId, ok.spreadsheetId, ok.gid);
  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "sheets_config",
    target: `organization:${orgId}`,
    metadata: { changed, origin: "propiedades" },
  });

  // Sincronización inmediata: el bot consulta la base, así que sin esto seguiría con la cartera de antes.
  const { syncPropertiesFromSheet } = await import("@/lib/sheets/properties-sync");
  const result = await syncPropertiesFromSheet(orgId);
  revalidatePath("/propiedades");
  revalidatePath("/propiedades/fuente");
  if (!result.ok) back(`error=${encodeURIComponent(`Se guardó la hoja pero la sincronización falló: ${result.error ?? "error"}`)}`);
  const paused = result.issues.find((i) => i.includes("quedaron pausadas"));
  back(`ok=${encodeURIComponent(`Hoja ${changed ? "cambiada" : "guardada"} y sincronizada: ${result.upserted} propiedades actualizadas.${paused ? ` ${paused}.` : ""}`)}`);
}
