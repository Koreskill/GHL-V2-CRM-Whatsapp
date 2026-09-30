import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { loadAudience } from "@/lib/campaigns/batches";
import { splitAudience } from "@/lib/campaigns/cost";
import { contactFiltersToParams, parseContactFilters } from "@/lib/crm/contact-filters";
import { listTemplates, templateBody, templateParamCount } from "@/lib/zernio/templates";
import { createEstimateAction } from "../actions";

export const metadata = { title: "Nueva campaña · Setter CRM" };

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";

export default async function NuevaCampanaPage({ searchParams }: PageProps<"/contactos/campanas/nueva">) {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const sp = await searchParams;
  const filters = parseContactFilters(sp);
  const qs = contactFiltersToParams(filters).toString();
  const error = typeof sp.error === "string" ? sp.error : null;

  const accounts = await getDb()
    .select({ externalId: channelAccounts.externalId })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.organizationId, session.organizationId), eq(channelAccounts.channel, "whatsapp"), eq(channelAccounts.status, "connected")));
  const lists = await Promise.all(accounts.map((a) => listTemplates({ accountId: a.externalId, status: "APPROVED" })));
  const seen = new Set<string>();
  const templates = lists
    .flatMap((r) => (r.success ? (r.data.templates ?? []) : []))
    .filter((t) => t.status === "APPROVED" && t.name && t.language && !seen.has(`${t.name}|${t.language}`) && seen.add(`${t.name}|${t.language}`));

  // Vista previa del público con los filtros actuales (antes de elegir plantilla: los excluidos por variable se ven después).
  const audience = await loadAudience(session.organizationId, filters);
  const { eligible, excluded } = splitAudience(audience, []);

  return (
    <>
      <PageHeader
        title="Nueva campaña"
        subtitle="Primero se estima: no se envía nada hasta confirmar la audiencia en el paso siguiente."
        actions={
          <Link href={`/contactos${qs ? `?${qs}` : ""}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Contactos
          </Link>
        }
      />
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      <Card className="mb-5 p-5">
        <p className="text-[15px] font-semibold text-ink">
          {eligible.length} {eligible.length === 1 ? "destinatario posible" : "destinatarios posibles"} por WhatsApp
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          Según los filtros de Contactos ({qs || "sin filtros: todos"}). {excluded.sin_whatsapp ? `${excluded.sin_whatsapp} quedan afuera por no tener conversación de WhatsApp.` : ""}
        </p>
      </Card>

      {templates.length === 0 ? (
        <Card className="p-6 text-[13.5px] text-muted">No hay plantillas aprobadas en tus cuentas de WhatsApp. Creá una en Plantillas y esperá la aprobación de Meta.</Card>
      ) : (
        <form action={createEstimateAction}>
          <input type="hidden" name="f" value={qs} />
          <Card className="grid max-w-2xl gap-4 p-6">
            <label className="flex flex-col gap-1 text-[12.5px] text-muted">
              Nombre de la campaña
              <input name="name" required maxLength={80} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted">
              Plantilla aprobada
              <select name="template" required className={field}>
                {templates.map((t) => (
                  <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                    {t.name} ({t.language}) · {templateParamCount(t)} variable(s) · {templateBody(t).slice(0, 50)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted">
              Variables de la plantilla (una por línea; usá {"{nombre}"} para el primer nombre de cada contacto)
              <textarea name="params" rows={3} className={`${field} h-auto py-2`} />
            </label>
            <div className="grid gap-4 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-[12.5px] text-muted sm:col-span-2">
                Precio por mensaje (tarifa vigente de Meta para tu plantilla)
                <input name="unitPrice" required inputMode="decimal" placeholder="0.0618" className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Moneda
                <select name="currency" className={field}>
                  <option value="USD">USD</option>
                  <option value="ARS">ARS</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Recargo %
                <input name="surchargePct" defaultValue="0" inputMode="decimal" className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Impuestos %
                <input name="taxPct" defaultValue="0" inputMode="decimal" className={field} />
              </label>
            </div>
            <div>
              <Button type="submit">Estimar costo</Button>
            </div>
          </Card>
        </form>
      )}
    </>
  );
}
