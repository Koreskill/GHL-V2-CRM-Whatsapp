import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Pause, Play, Send } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { BATCH_STATUS_LABEL, batchProgress, getBatch, listRecipients, sendingEnabled } from "@/lib/campaigns/batches";
import { EXCLUSION_LABEL, estimateCost, personalizeParams } from "@/lib/campaigns/cost";
import { isUuid } from "@/lib/api";
import { listTemplates, renderTemplate } from "@/lib/zernio/templates";
import { cancelBatchAction, confirmBatchAction, pauseBatchAction, resumeBatchAction, startBatchAction } from "../actions";

export const metadata = { title: "Campaña · Setter CRM" };

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";
const RECIPIENT_STATUS: Record<string, string> = { pendiente: "En cola", enviando: "Enviando", enviado: "Aceptado", fallido: "Falló", omitido: "Omitido" };
const MESSAGE_STATUS: Record<string, string> = { pending: "En cola", sent: "Aceptado por el proveedor", delivered: "Entregado", read: "Leído", failed: "Falló en el canal" };

export default async function CampanaPage({ params, searchParams }: PageProps<"/contactos/campanas/[batchId]">) {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const orgId = session.organizationId;
  const { batchId } = await params;
  if (!isUuid(batchId)) notFound();
  const batch = await getBatch(orgId, batchId);
  if (!batch) notFound();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;

  const [progress, recipients, account] = await Promise.all([
    batchProgress(orgId, batchId),
    listRecipients(orgId, batchId, 100),
    batch.channelAccountId
      ? getDb()
          .select({ name: channelAccounts.name, handle: channelAccounts.handle, status: channelAccounts.status, externalId: channelAccounts.externalId })
          .from(channelAccounts)
          .where(and(eq(channelAccounts.id, batch.channelAccountId), eq(channelAccounts.organizationId, orgId)))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  // Vista previa con un destinatario real (el primero congelado) y la plantilla aprobada.
  let preview: string | null = null;
  if (account) {
    const res = await listTemplates({ accountId: account.externalId, name: batch.templateName, language: batch.templateLanguage, status: "APPROVED" });
    const t = res.success ? res.data.templates?.find((x) => x.name === batch.templateName && x.language === batch.templateLanguage) : undefined;
    const sample = personalizeParams(batch.params, recipients[0]?.name ?? "María");
    if (t && sample) preview = renderTemplate(t, sample);
  }

  const cost = estimateCost({
    count: batch.audienceCount,
    unitPrice: Number(batch.unitPrice),
    surchargePct: Number(batch.surchargePct),
    taxPct: Number(batch.taxPct),
  });
  const money = (n: number) => `${batch.currency} ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  const cancellable = ["estimada", "confirmada", "programada", "enviando", "pausada"].includes(batch.status);
  const total = batch.audienceCount || 1;

  return (
    <>
      <PageHeader
        title={batch.name}
        subtitle={`${BATCH_STATUS_LABEL[batch.status] ?? batch.status} · plantilla ${batch.templateName} · ${account ? `cuenta ${account.name ?? account.handle ?? "WhatsApp"}` : "sin cuenta asignada"}${
          batch.status === "programada" && batch.scheduledAt ? ` · sale ${batch.scheduledAt.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}` : ""
        }`}
        actions={
          <Link href="/contactos/campanas" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Campañas
          </Link>
        }
      />
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
      {account && account.status !== "connected" && (
        <p className="mb-5 rounded-lg bg-accent-amber/10 px-3 py-2 text-[13px] text-ink">La cuenta emisora está desconectada: el envío no arranca (o se pausa solo) hasta reconectarla.</p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="text-[15px] font-semibold text-ink">Estimación</h2>
          <dl className="mt-3 divide-y divide-line text-[13.5px]">
            <Row label="Destinatarios elegibles" value={String(batch.audienceCount)} />
            <Row label={`Precio por mensaje (${batch.rateSource}, ${batch.rateDate?.toLocaleDateString("es-AR") ?? "s/f"})`} value={String(Number(batch.unitPrice))} />
            <Row label="Subtotal" value={money(cost.subtotal)} />
            <Row label={`Recargo ${Number(batch.surchargePct)}%`} value={money(cost.surcharge)} />
            <Row label={`Impuestos ${Number(batch.taxPct)}%`} value={money(cost.tax)} />
            <Row label="Total estimado" value={money(cost.total)} strong />
          </dl>
          <p className="mt-3 text-[12px] text-muted">Estimado, no facturado: cómo se calculó: {cost.formula}</p>
          {Object.keys(batch.excluded).length > 0 && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-[12.5px] font-medium text-ink">Excluidos</p>
              <ul className="mt-1 text-[12.5px] text-muted">
                {Object.entries(batch.excluded).map(([k, n]) => (
                  <li key={k}>{n} · {EXCLUSION_LABEL[k] ?? k}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <p className="text-[12.5px] font-medium text-ink">Vista previa{recipients[0]?.name ? ` (para ${recipients[0].name})` : ""}</p>
            {preview ? (
              <p className="mt-2 rounded-xl bg-field px-3 py-2 text-[13.5px] whitespace-pre-wrap text-ink">{preview}</p>
            ) : (
              <p className="mt-1 text-[12.5px] text-muted">No se pudo armar la vista previa (la plantilla no está disponible en la cuenta o falta un dato).</p>
            )}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-[15px] font-semibold text-ink">Envío</h2>
          {batch.status === "estimada" && (
            <form action={confirmBatchAction} className="mt-3 grid gap-3">
              <input type="hidden" name="batchId" value={batch.id} />
              <p className="text-[13px] text-muted">
                Confirmar congela la audiencia: se envía exactamente a estas {batch.audienceCount} personas, aunque después cambien los grupos, etiquetas o filtros (quien pida la baja antes de su envío se omite). Escribí la cantidad para confirmar.
              </p>
              <input name="typed" inputMode="numeric" required placeholder={String(batch.audienceCount)} className={field} />
              <div>
                <Button type="submit">Congelar audiencia y confirmar</Button>
              </div>
            </form>
          )}
          {(batch.status === "confirmada" || batch.status === "programada") && (
            <form action={startBatchAction} className="mt-3 grid gap-3">
              <input type="hidden" name="batchId" value={batch.id} />
              {!sendingEnabled() && (
                <p className="rounded-lg bg-accent-amber/10 px-3 py-2 text-[12.5px] text-ink">
                  El envío real está deshabilitado en el servidor. Se activa con CAMPAIGNS_SEND_ENABLED=true cuando el responsable revise esta vista previa.
                </p>
              )}
              <label className="flex max-w-xs flex-col gap-1 text-[12.5px] text-muted">
                Programar (hora de Argentina; vacío = ahora)
                <input type="datetime-local" name="when" className={field} />
              </label>
              <div>
                <Button type="submit" disabled={!sendingEnabled()}>
                  <Send className="size-4" strokeWidth={1.8} />
                  {batch.status === "programada" ? "Reprogramar / enviar" : "Programar o enviar"}
                </Button>
              </div>
            </form>
          )}
          {(batch.status === "enviando" || batch.status === "programada") && (
            <form action={pauseBatchAction} className="mt-3">
              <input type="hidden" name="batchId" value={batch.id} />
              <Button type="submit" variant="secondary">
                <Pause className="size-4" strokeWidth={1.8} /> Pausar
              </Button>
              <p className="mt-1 text-[12px] text-muted">Termina el mensaje que está saliendo y no toma más destinatarios.</p>
            </form>
          )}
          {batch.status === "pausada" && (
            <form action={resumeBatchAction} className="mt-3">
              <input type="hidden" name="batchId" value={batch.id} />
              <Button type="submit" disabled={!sendingEnabled()}>
                <Play className="size-4" strokeWidth={1.8} /> Reanudar
              </Button>
            </form>
          )}
          {!cancellable && <p className="mt-3 text-[13px] text-muted">Este lote ya no admite cambios.</p>}

          {progress && batch.status !== "estimada" && (
            <div className="mt-4 border-t border-line pt-4">
              <div className="mb-3 h-2 overflow-hidden rounded-full bg-field">
                <div className="h-full bg-primary" style={{ width: `${Math.round(((progress.aceptado + progress.fallido + progress.omitido) / total) * 100)}%` }} />
              </div>
              <ul className="grid grid-cols-3 gap-2 text-[13px]">
                <Stat label="En cola" value={progress.pendiente + progress.enviando} />
                <Stat label="Aceptados" value={progress.aceptado} hint="Zernio los tomó" />
                <Stat label="Entregados" value={progress.entregado} hint="WhatsApp confirmó" />
                <Stat label="Leídos" value={progress.leido} />
                <Stat label="Respondieron" value={progress.respondieron} hint="no es una venta" />
                <Stat label="Fallidos" value={progress.fallido + progress.fallo_canal} />
                <Stat label="Omitidos" value={progress.omitido} hint="baja o cancelada" />
              </ul>
            </div>
          )}

          {cancellable && (
            <form action={cancelBatchAction} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="batchId" value={batch.id} />
              <Button type="submit" variant="secondary">Cancelar campaña</Button>
            </form>
          )}
        </Card>
      </div>

      {recipients.length > 0 && (
        <Card className="mt-5 p-6">
          <h2 className="text-[15px] font-semibold text-ink">Destinatarios congelados{batch.audienceCount > recipients.length ? ` (primeros ${recipients.length} de ${batch.audienceCount})` : ""}</h2>
          <table className="mt-3 w-full text-[13px]">
            <thead className="text-left text-[11.5px] text-muted uppercase">
              <tr>
                <th className="py-1.5 font-medium">Contacto</th>
                <th className="py-1.5 font-medium">Estado</th>
                <th className="py-1.5 font-medium">En el canal</th>
                <th className="py-1.5 font-medium">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {recipients.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 text-ink">{r.name ?? "Sin nombre"}</td>
                  <td className="py-1.5 text-ink">{RECIPIENT_STATUS[r.status] ?? r.status}</td>
                  <td className="py-1.5 text-muted">{r.message_status ? (MESSAGE_STATUS[r.message_status] ?? r.message_status) : "—"}</td>
                  <td className="py-1.5 text-muted">{r.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-2">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "font-semibold text-ink" : "text-ink"}>{value}</dd>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <li className="rounded-lg bg-field px-3 py-2">
      <span className="block text-[11px] text-muted uppercase">{label}</span>
      <span className="font-semibold tabular-nums text-ink">{value}</span>
      {hint && <span className="block text-[10.5px] text-muted">{hint}</span>}
    </li>
  );
}
