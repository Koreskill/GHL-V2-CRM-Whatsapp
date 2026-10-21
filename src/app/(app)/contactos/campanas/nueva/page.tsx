import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth";
import { loadAudience, senderAccounts } from "@/lib/campaigns/batches";
import { EXCLUSION_LABEL, splitAudience } from "@/lib/campaigns/cost";
import { contactFiltersToParams, parseContactFilters } from "@/lib/crm/contact-filters";
import { cleanIds, listGroups, listLabels, listSegments } from "@/lib/crm/groups";
import { describeFilters } from "@/lib/crm/describe-filters";
import { listTemplates, templateBody, templateParamCount } from "@/lib/zernio/templates";
import { createEstimateAction } from "../actions";

export const metadata = { title: "Nueva campaña · Setter CRM" };

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function NuevaCampanaPage({ searchParams }: PageProps<"/contactos/campanas/nueva">) {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const orgId = session.organizationId;
  const sp = await searchParams;
  const filters = parseContactFilters(sp);
  const sources = { groupIds: cleanIds(many(sp.g)), labelIds: cleanIds(many(sp.l)), segmentIds: cleanIds(many(sp.s)) };
  const error = typeof sp.error === "string" ? sp.error : null;

  const [accounts, groups, labels, segments] = await Promise.all([senderAccounts(orgId), listGroups(orgId), listLabels(orgId), listSegments(orgId, session.user.id)]);
  const connected = accounts.filter((a) => a.status === "connected");
  const accountId = typeof sp.cuenta === "string" && connected.some((a) => a.id === sp.cuenta) ? sp.cuenta : (connected[0]?.id ?? null);
  const account = accountId ? accounts.find((a) => a.id === accountId) : null;

  // La query completa (filtros + fuentes + cuenta) viaja al paso de estimación tal cual.
  const q = contactFiltersToParams(filters);
  for (const id of sources.groupIds) q.append("g", id);
  for (const id of sources.labelIds) q.append("l", id);
  for (const id of sources.segmentIds) q.append("s", id);
  if (accountId) q.set("cuenta", accountId);

  const audience = accountId ? await loadAudience(orgId, { filters, sources, channelAccountId: accountId }) : [];
  const { eligible, excluded } = splitAudience(audience, []);

  const templates = account
    ? await (async () => {
        const { channelAccounts } = await import("@/db/schema");
        const { getDb } = await import("@/db");
        const { and, eq } = await import("drizzle-orm");
        const [row] = await getDb().select({ externalId: channelAccounts.externalId }).from(channelAccounts).where(and(eq(channelAccounts.id, account.id), eq(channelAccounts.organizationId, orgId)));
        const r = row ? await listTemplates({ accountId: row.externalId, status: "APPROVED" }) : null;
        return r?.success ? (r.data.templates ?? []).filter((t) => t.status === "APPROVED" && t.name && t.language) : [];
      })()
    : [];

  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const labelName = new Map(labels.map((l) => [l.id, l.name]));
  const segmentName = new Map(segments.map((s) => [s.id, s.name]));
  const chosen = [
    ...sources.groupIds.map((id) => `grupo «${groupName.get(id) ?? "?"}»`),
    ...sources.labelIds.map((id) => `etiqueta «${labelName.get(id) ?? "?"}»`),
    ...sources.segmentIds.map((id) => `segmento «${segmentName.get(id) ?? "?"}»`),
  ];
  const criteria = describeFilters(filters, { labels: labelName, groups: groupName });

  return (
    <>
      <PageHeader
        title="Nueva campaña"
        subtitle="Primero se estima: no se envía nada hasta confirmar la audiencia en el paso siguiente."
        actions={
          <Link href="/contactos/campanas" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Campañas
          </Link>
        }
      />
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      {connected.length === 0 ? (
        <Card className="p-6 text-[13.5px] text-muted">No hay cuentas de WhatsApp conectadas. Conectá una en Configuración.</Card>
      ) : (
        <>
          {/* Paso 1 y 2: cuenta emisora y audiencia. Es un GET: recalcula el conteo sin guardar nada. */}
          <form method="get" className="mb-5">
            {Object.entries(Object.fromEntries(contactFiltersToParams(filters))).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <Card className="grid gap-5 p-6">
              <label className="flex max-w-md flex-col gap-1 text-[12.5px] text-muted">
                1 · Cuenta que envía
                <select name="cuenta" defaultValue={accountId ?? ""} className={field}>
                  {connected.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? a.handle ?? "WhatsApp"} {a.handle ? `(${a.handle})` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <p className="text-[12.5px] text-muted">2 · A quién (se suman entre sí; sin elegir nada, son todos los contactos{criteria.length ? " que cumplen los filtros" : ""})</p>
                <div className="mt-2 grid gap-4 md:grid-cols-3">
                  <Pick title="Grupos" name="g" items={groups.map((g) => ({ id: g.id, label: `${g.name} (${g.n})` }))} chosen={sources.groupIds} empty="Sin grupos. Se crean en Contactos → Grupos." />
                  <Pick title="Etiquetas" name="l" items={labels.map((l) => ({ id: l.id, label: `${l.name} (${l.n})` }))} chosen={sources.labelIds} empty="Sin etiquetas." />
                  <Pick title="Segmentos (vistas guardadas)" name="s" items={segments.map((s) => ({ id: s.id, label: s.name }))} chosen={sources.segmentIds} empty="Sin segmentos. Se guardan desde los filtros de Contactos." />
                </div>
              </div>
              <div>
                <Button type="submit" variant="secondary">Actualizar destinatarios</Button>
              </div>
            </Card>
          </form>

          <Card className="mb-5 p-5">
            <p className="text-[15px] font-semibold text-ink">
              {eligible.length} {eligible.length === 1 ? "destinatario posible" : "destinatarios posibles"}
            </p>
            <p className="mt-1 text-[12.5px] text-muted">
              Criterio: {chosen.length ? chosen.join(" o ") : "todos los contactos"}
              {criteria.length ? `, y además ${criteria.join(", ")}` : ""}. Los excluidos por variable vacía se ven al estimar.
            </p>
            {Object.keys(excluded).length > 0 && (
              <ul className="mt-2 text-[12.5px] text-muted">
                {Object.entries(excluded).map(([k, n]) => (
                  <li key={k}>Excluidos: {n} · {EXCLUSION_LABEL[k] ?? k}</li>
                ))}
              </ul>
            )}
          </Card>

          {templates.length === 0 ? (
            <Card className="p-6 text-[13.5px] text-muted">No hay plantillas aprobadas en esta cuenta de WhatsApp. Creá una en Plantillas y esperá la aprobación de Meta.</Card>
          ) : (
            <form action={createEstimateAction}>
              <input type="hidden" name="q" value={q.toString()} />
              <input type="hidden" name="account" value={accountId ?? ""} />
              <Card className="grid max-w-2xl gap-4 p-6">
                <p className="text-[12.5px] text-muted">3 · Contenido</p>
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
                  Variables de la plantilla (una por línea; {"{nombre}"} = primer nombre de cada contacto). La vista previa con un destinatario real aparece al estimar.
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
      )}
    </>
  );
}

function Pick({ title, name, items, chosen, empty }: { title: string; name: string; items: { id: string; label: string }[]; chosen: string[]; empty: string }) {
  return (
    <fieldset className="rounded-lg border border-line p-3">
      <legend className="px-1 text-[11px] font-medium tracking-wide text-muted uppercase">{title}</legend>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-muted">{empty}</p>
      ) : (
        <div className="grid max-h-44 gap-1.5 overflow-y-auto">
          {items.map((i) => (
            <label key={i.id} className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name={name} value={i.id} defaultChecked={chosen.includes(i.id)} />
              {i.label}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}
