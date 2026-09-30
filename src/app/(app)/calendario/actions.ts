"use server";

import { redirect } from "next/navigation";
import { isUuid } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { testConnection } from "@/lib/calendar/calcom-api";
import { credsOf, getIntegration, markStatus, parseHttpsUrl, removeIntegration, saveIntegration } from "@/lib/calendar/integration";
import { syncVisit } from "@/lib/calendar/sync";
import { authorizeAction } from "@/lib/deals/guard";

const text = (form: FormData, key: string, max = 300) => String(form.get(key) ?? "").trim().slice(0, max);
const back = (query: string): never => redirect(`/configuracion?tab=calendario&${query}`);

// Conectar o editar el Cal.com DE ESTA inmobiliaria. Solo administradores. La clave se cifra en el
// servidor; dejarla vacía al editar conserva la ya guardada.
export async function saveCalendarIntegration(formData: FormData) {
  const session = await requireRole("admin");
  if (!session) redirect("/");

  const eventTypeId = Number(text(formData, "eventTypeId", 12));
  if (!Number.isInteger(eventTypeId) || eventTypeId <= 0) back("error=" + encodeURIComponent("El id del tipo de evento tiene que ser un número."));
  const bookingUrlRaw = text(formData, "bookingUrl", 500);
  const bookingUrl = bookingUrlRaw ? parseHttpsUrl(bookingUrlRaw) : null;
  if (bookingUrlRaw && !bookingUrl) back("error=" + encodeURIComponent("El enlace de la agenda tiene que ser https."));
  const fallbackEmail = text(formData, "fallbackEmail", 120);
  if (fallbackEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallbackEmail)) back("error=" + encodeURIComponent("El email de respaldo no es válido."));

  const res = await saveIntegration({
    orgId: session.organizationId,
    apiKey: text(formData, "apiKey", 200),
    eventTypeId,
    bookingUrl,
    timeZone: text(formData, "timeZone", 60) || "America/Argentina/Buenos_Aires",
    fallbackEmail: fallbackEmail || null,
  });
  if (!res.ok) back("error=" + encodeURIComponent(res.error));
  back("saved=1");
}

export async function testCalendarIntegration() {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const integration = await getIntegration(session.organizationId);
  const creds = integration ? credsOf(integration) : null;
  if (!integration || !creds) back("error=" + encodeURIComponent("Configurá primero la integración."));
  const res = await testConnection(creds!, integration!.eventTypeId);
  await markStatus(integration!.id, res.ok ? "conectada" : "error", res.ok ? null : res.error);
  back(res.ok ? `tested=1` : "error=" + encodeURIComponent(res.error));
}

export async function disconnectCalendarIntegration() {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  await removeIntegration(session.organizationId);
  back("disconnected=1");
}

// Reintentar la reserva de UNA visita. No duplica: el vínculo es único por visita.
export async function retryVisitSync(formData: FormData) {
  const { orgId } = await authorizeAction();
  const visitId = text(formData, "visitId", 64);
  if (!isUuid(visitId)) redirect("/calendario");
  const res = await syncVisit(orgId, visitId);
  redirect(`/calendario${res.ok ? "" : `?error=${encodeURIComponent(res.error)}`}`);
}
