import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Power } from "lucide-react";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/api";
import { requireRole } from "@/lib/auth";
import { senderAccounts } from "@/lib/campaigns/batches";
import { listGroups, listLabels, listSegments, normalizeSources } from "@/lib/crm/groups";
import { getSequence, recentEnrollments } from "@/lib/followups/queries";
import { STOP_REASON_LABEL } from "@/lib/followups/run";
import { deleteSequenceAction, saveSequenceAction, toggleSequenceAction } from "../actions";

export const metadata = { title: "Secuencia · Setter CRM" };

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";
const ENROLL_STATUS: Record<string, string> = { activa: "En curso", completada: "Completó", respondio: "Respondió", detenida: "Detenida" };
const DEFAULT_STEPS = [
  { delay: 2, unit: "h", body: "Hola {nombre}, ¿pudiste ver lo que te mandé? Si querés te paso más opciones." },
  { delay: 6, unit: "h", body: "{nombre}, quedo atento por si te interesa coordinar una visita o recibir algo parecido." },
];

export default async function SecuenciaPage({ params, searchParams }: PageProps<"/seguimientos/[sequenceId]">) {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const orgId = session.organizationId;
  const { sequenceId } = await params;
  const isNew = sequenceId === "nueva";
  if (!isNew && !isUuid(sequenceId)) notFound();
  const data = isNew ? null : await getSequence(orgId, sequenceId);
  if (!isNew && !data) notFound();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const ok = sp.ok === "guardada";

  const [accounts, groups, labels, segments, enrollments] = await Promise.all([
    senderAccounts(orgId),
    listGroups(orgId),
    listLabels(orgId),
    listSegments(orgId, session.user.id),
    data ? recentEnrollments(orgId, data.seq.id) : Promise.resolve([]),
  ]);
  const seq = data?.seq;
  const audience = normalizeSources(seq?.audience ?? {});
  const steps = data?.steps.length
    ? data.steps.map((s) => (s.delayMinutes % 60 === 0 ? { delay: s.delayMinutes / 60, unit: "h", body: s.body } : { delay: s.delayMinutes, unit: "m", body: s.body }))
    : DEFAULT_STEPS;
  const rows = [...steps, ...Array.from({ length: Math.max(0, 5 - steps.length) }, () => ({ delay: 0, unit: "h", body: "" }))];

  return (
    <>
      <PageHeader
        title={seq?.name ?? "Nueva secuencia"}
        subtitle={seq ? (seq.enabled ? "Encendida: inscribe conversaciones y envía pasos." : "Apagada: no inscribe ni envía nada.") : "Se guarda apagada. La prendés cuando la revises."}
        actions={
          <Link href="/seguimientos" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Seguimientos
          </Link>
        }
      />
      {error && <p className="mb-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
      {ok && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-ink">Secuencia guardada.</p>}

      {seq && (
        <form action={toggleSequenceAction} className="mb-5">
          <input type="hidden" name="id" value={seq.id} />
          <input type="hidden" name="enabled" value={seq.enabled ? "0" : "1"} />
          <Button type="submit" variant={seq.enabled ? "secondary" : "primary"}>
            <Power className="size-4" strokeWidth={1.8} /> {seq.enabled ? "Apagar (detiene las que están en curso)" : "Encender"}
          </Button>
        </form>
      )}

      <form action={saveSequenceAction}>
        {seq && <input type="hidden" name="id" value={seq.id} />}
        <div className="grid gap-5 lg:grid-cols-2">
          <Card className="grid gap-4 p-6">
            <h2 className="text-[15px] font-semibold text-ink">Cuándo y a quién</h2>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted">
              Nombre
              <input name="name" required maxLength={80} defaultValue={seq?.name ?? ""} className={field} />
            </label>
            <p className="rounded-lg bg-field px-3 py-2 text-[12.5px] text-muted">
              Se inicia cuando la última palabra fue nuestra (del bot o de una persona) y el contacto no contestó. Un ciclo por cada mensaje del contacto: si responde, se corta y puede volver a empezar cuando vuelva a callar.
            </p>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted">
              Cuenta
              <select name="account" defaultValue={seq?.channelAccountId ?? ""} className={field}>
                <option value="">Todas las cuentas</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.handle ?? "WhatsApp"}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 md:grid-cols-3">
              <Pick title="Grupos" name="g" items={groups.map((g) => ({ id: g.id, label: g.name }))} chosen={audience.groupIds ?? []} />
              <Pick title="Etiquetas" name="l" items={labels.map((l) => ({ id: l.id, label: l.name }))} chosen={audience.labelIds ?? []} />
              <Pick title="Segmentos" name="s" items={segments.map((s) => ({ id: s.id, label: s.name }))} chosen={audience.segmentIds ?? []} />
            </div>
            <p className="text-[12px] text-muted">Sin elegir nada, alcanza a cualquier contacto (nunca a quien pidió la baja).</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Desde (hora)
                <input name="start" type="number" min={0} max={23} defaultValue={seq?.allowedStartHour ?? 8} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Hasta (hora)
                <input name="end" type="number" min={1} max={24} defaultValue={seq?.allowedEndHour ?? 22} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Zona horaria
                <input name="timezone" defaultValue={seq?.timezone ?? "America/Argentina/Buenos_Aires"} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Máximo por día
                <input name="maxPerDay" type="number" min={1} max={10} defaultValue={seq?.maxPerDay ?? 5} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Separación mínima (min)
                <input name="minGap" type="number" min={15} max={720} defaultValue={seq?.minGapMinutes ?? 60} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-[12.5px] text-muted">
                Margen antes del cierre de ventana (min)
                <input name="margin" type="number" min={0} max={180} defaultValue={seq?.windowMarginMinutes ?? 15} className={field} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name="stopOnHandoff" defaultChecked={seq?.stopOnHandoff ?? true} className="size-4 accent-[var(--color-primary)]" />
              Detener si la conversación se derivó a una persona (bot pausado)
            </label>
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" name="stopOnDealClosed" defaultChecked={seq?.stopOnDealClosed ?? true} className="size-4 accent-[var(--color-primary)]" />
              Detener si la oportunidad del contacto se cerró (ganada o perdida)
            </label>
          </Card>

          <Card className="grid content-start gap-4 p-6">
            <h2 className="text-[15px] font-semibold text-ink">Pasos</h2>
            <p className="text-[12.5px] text-muted">
              Cada espera cuenta desde nuestro último mensaje (o desde el paso anterior). Se usa {"{nombre}"} para el primer nombre. Un paso que no entra antes del cierre de la ventana de 24 h no sale: la secuencia se detiene.
            </p>
            {rows.map((s, i) => (
              <div key={i} className="grid gap-2 rounded-lg border border-line p-3">
                <div className="flex items-center gap-2 text-[12.5px] text-muted">
                  <span className="font-medium text-ink">Paso {i + 1}</span>
                  <span>esperar</span>
                  <input name={`delay${i}`} inputMode="decimal" defaultValue={s.body ? String(s.delay) : ""} className={`${field} w-20`} aria-label={`Espera del paso ${i + 1}`} />
                  <select name={`unit${i}`} defaultValue={s.unit} className={field} aria-label="Unidad">
                    <option value="m">minutos</option>
                    <option value="h">horas</option>
                  </select>
                </div>
                <textarea name={`body${i}`} rows={2} maxLength={1000} defaultValue={s.body} placeholder="Vacío = sin este paso" className={`${field} h-auto py-2`} />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button type="submit">Guardar secuencia</Button>
            </div>
          </Card>
        </div>
      </form>

      {seq && (
        <>
          <Card className="mt-5 p-6">
            <h2 className="text-[15px] font-semibold text-ink">Conversaciones en esta secuencia</h2>
            {enrollments.length === 0 ? (
              <p className="mt-2 text-[13px] text-muted">Todavía ninguna.</p>
            ) : (
              <table className="mt-3 w-full text-[13px]">
                <thead className="text-left text-[11.5px] text-muted uppercase">
                  <tr>
                    <th className="py-1.5 font-medium">Contacto</th>
                    <th className="py-1.5 font-medium">Estado</th>
                    <th className="py-1.5 font-medium">Enviados</th>
                    <th className="py-1.5 font-medium">Próximo</th>
                    <th className="py-1.5 font-medium">Motivo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {enrollments.map((e) => (
                    <tr key={e.id}>
                      <td className="py-1.5">
                        <Link href={`/conversaciones/${e.conversation_id}`} className="text-ink hover:underline">
                          {e.name ?? "Sin nombre"}
                        </Link>
                      </td>
                      <td className="py-1.5 text-ink">{ENROLL_STATUS[e.status] ?? e.status}</td>
                      <td className="py-1.5 tabular-nums">{e.sent_count}</td>
                      <td className="py-1.5 text-muted">
                        {e.status === "activa" && e.next_run_at ? new Date(e.next_run_at).toLocaleString("es-AR", { timeZone: seq.timezone }) : "—"}
                      </td>
                      <td className="py-1.5 text-muted">{e.stop_reason ? (STOP_REASON_LABEL[e.stop_reason] ?? e.stop_reason) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <form action={deleteSequenceAction} className="mt-5">
            <input type="hidden" name="id" value={seq.id} />
            <Button type="submit" variant="secondary">Borrar secuencia</Button>
          </form>
        </>
      )}
    </>
  );
}

function Pick({ title, name, items, chosen }: { title: string; name: string; items: { id: string; label: string }[]; chosen: string[] }) {
  return (
    <fieldset className="rounded-lg border border-line p-3">
      <legend className="px-1 text-[11px] font-medium tracking-wide text-muted uppercase">{title}</legend>
      {items.length === 0 ? (
        <p className="text-[12px] text-muted">Ninguno</p>
      ) : (
        <div className="grid max-h-36 gap-1.5 overflow-y-auto">
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
