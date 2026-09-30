import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Send } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth";
import { batchProgress, getBatch, sendingEnabled } from "@/lib/campaigns/batches";
import { EXCLUSION_LABEL, estimateCost } from "@/lib/campaigns/cost";
import { isUuid } from "@/lib/api";
import { cancelBatchAction, confirmBatchAction, sendBatchAction } from "../actions";

export const metadata = { title: "Campaña · Setter CRM" };

const STATUS: Record<string, string> = {
  estimada: "Estimada (nada enviado)",
  confirmada: "Confirmada: audiencia congelada",
  enviando: "Enviando",
  completada: "Completada",
  cancelada: "Cancelada",
};

export default async function CampanaPage({ params, searchParams }: PageProps<"/contactos/campanas/[batchId]">) {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const { batchId } = await params;
  if (!isUuid(batchId)) notFound();
  const batch = await getBatch(session.organizationId, batchId);
  if (!batch) notFound();
  const error = typeof (await searchParams).error === "string" ? String((await searchParams).error) : null;

  const progress = await batchProgress(session.organizationId, batchId);
  const cost = estimateCost({
    count: batch.audienceCount,
    unitPrice: Number(batch.unitPrice),
    surchargePct: Number(batch.surchargePct),
    taxPct: Number(batch.taxPct),
  });
  const money = (n: number) => `${batch.currency} ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  const open = batch.status === "estimada" || batch.status === "confirmada" || batch.status === "enviando";

  return (
    <>
      <PageHeader
        title={batch.name}
        subtitle={`${STATUS[batch.status] ?? batch.status} · plantilla ${batch.templateName}`}
        actions={
          <Link href="/contactos/campanas" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Campañas
          </Link>
        }
      />
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

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
          <p className="mt-3 text-[12px] text-muted">Cómo se calculó: {cost.formula}</p>
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
        </Card>

        <Card className="p-6">
          <h2 className="text-[15px] font-semibold text-ink">Envío</h2>
          {batch.status === "estimada" && (
            <form action={confirmBatchAction} className="mt-3 grid gap-3">
              <input type="hidden" name="batchId" value={batch.id} />
              <p className="text-[13px] text-muted">
                Confirmar congela la audiencia: se envía exactamente a estas {batch.audienceCount} personas, aunque después cambien los filtros. Escribí la cantidad para confirmar.
              </p>
              <input name="typed" inputMode="numeric" required placeholder={String(batch.audienceCount)} className="h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none" />
              <div>
                <Button type="submit">Congelar audiencia y confirmar</Button>
              </div>
            </form>
          )}
          {(batch.status === "confirmada" || batch.status === "enviando") && (
            <form action={sendBatchAction} className="mt-3 grid gap-3">
              <input type="hidden" name="batchId" value={batch.id} />
              {!sendingEnabled() && (
                <p className="rounded-lg bg-accent-amber/10 px-3 py-2 text-[12.5px] text-ink">
                  El envío real está deshabilitado en el servidor. Se activa con CAMPAIGNS_SEND_ENABLED=true cuando el responsable revise esta vista previa.
                </p>
              )}
              <div>
                <Button type="submit" disabled={!sendingEnabled()}>
                  <Send className="size-4" strokeWidth={1.8} />
                  {batch.status === "enviando" ? "Reanudar envío" : "Enviar ahora"}
                </Button>
              </div>
            </form>
          )}
          {!open && <p className="mt-3 text-[13px] text-muted">Este lote ya no admite cambios.</p>}

          {Object.keys(progress).length > 0 && (
            <ul className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 text-[13px]">
              {Object.entries(progress).map(([k, n]) => (
                <li key={k} className="rounded-lg bg-field px-3 py-2">
                  <span className="block text-[11.5px] text-muted uppercase">{k}</span>
                  <span className="font-semibold tabular-nums text-ink">{n}</span>
                </li>
              ))}
            </ul>
          )}

          {open && (
            <form action={cancelBatchAction} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="batchId" value={batch.id} />
              <Button type="submit" variant="secondary">Cancelar campaña</Button>
            </form>
          )}
        </Card>
      </div>
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
