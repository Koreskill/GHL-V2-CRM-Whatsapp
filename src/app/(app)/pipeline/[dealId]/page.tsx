import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CalendarClock, History, MessageCircle, Plus, Target, Trophy, XCircle } from "lucide-react";
import { CloseDealPanel } from "@/components/pipeline/close-deal-panel";
import { DealPropertiesPanel } from "@/components/pipeline/deal-properties-panel";
import { StageSelect } from "@/components/pipeline/stage-select";
import { Card, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/api";
import { requireOrgId } from "@/lib/auth";
import { listDealEvents, listDealProperties, getDeal, listLinkableProperties } from "@/lib/deals/queries";
import { listTeam, memberLabel } from "@/lib/deals/team";
import { listVisitsByDeal } from "@/lib/visits/queries";
import { VisitCard } from "@/components/visits/visit-card";
import { formatListDate } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/pipeline";
import { updateDeal } from "../actions";
import { cn } from "@/lib/utils";

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[14px] text-ink focus:border-primary focus:outline-none";
const labelClass = "block text-[13px] font-medium text-ink";

const ACTION_LABEL: Record<string, string> = {
  creada: "Creada",
  etapa: "Cambió de etapa",
  ganada: "Marcada ganada",
  perdida: "Marcada perdida",
  reabierta: "Reabierta",
  responsable: "Cambió el responsable",
  propiedad_vinculada: "Vinculó una propiedad",
  propiedad_desvinculada: "Desvinculó una propiedad",
};

export default async function DealPage({ params, searchParams }: PageProps<"/pipeline/[dealId]">) {
  const orgId = await requireOrgId();
  const { dealId } = await params;
  if (!isUuid(dealId)) notFound();

  const deal = await getDeal(dealId, orgId);
  if (!deal) notFound();

  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 300) : null;
  const guardado = sp.guardado === "1";

  const [linked, linkable, events, team, visits] = await Promise.all([
    listDealProperties(dealId, orgId),
    listLinkableProperties(orgId, dealId),
    listDealEvents(dealId, orgId),
    listTeam(orgId),
    listVisitsByDeal(dealId, orgId),
  ]);

  const closed = deal.status !== "abierta";
  const won = deal.status === "ganada";

  return (
    <>
      <PageHeader
        title={deal.title}
        subtitle={`${deal.contactName}${deal.contactPhone ? ` · ${deal.contactPhone}` : ""}`}
        actions={
          <Link
            href="/pipeline"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <ArrowLeft className="size-4" strokeWidth={1.7} />
            Pipeline
          </Link>
        }
      />

      {guardado && (
        <p className="mb-5 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-accent-green">Cambios guardados.</p>
      )}
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      {closed && (
        <Card
          className={cn(
            "mb-5 flex items-center gap-3 p-4",
            won ? "border-accent-green/40 bg-accent-green/5" : "border-line bg-field",
          )}
        >
          {won ? (
            <Trophy className="size-5 shrink-0 text-accent-green" strokeWidth={1.7} />
          ) : (
            <XCircle className="size-5 shrink-0 text-muted" strokeWidth={1.7} />
          )}
          <p className="flex-1 text-[13.5px] text-ink">
            {won ? "Oportunidad ganada." : `Oportunidad perdida en ${STAGE_LABEL[deal.stage]}.`}
            {!won && deal.lostReason && <span className="text-muted"> Motivo: {deal.lostReason}</span>}
            {deal.closedAt && <span className="text-muted"> · {formatListDate(deal.closedAt)}</span>}
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <form action={updateDeal} className="flex flex-col gap-4">
              <input type="hidden" name="dealId" value={dealId} />

              <div>
                <label className={labelClass} htmlFor="title">
                  Título
                </label>
                <input id="title" name="title" defaultValue={deal.title} className={inputClass} />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="assignedUserId">
                    Responsable
                  </label>
                  <select
                    id="assignedUserId"
                    name="assignedUserId"
                    defaultValue={deal.assignedUserId ?? ""}
                    className={inputClass}
                  >
                    <option value="">Sin asignar</option>
                    {team.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.email}
                      </option>
                    ))}
                    {/* El responsable actual puede no estar en la lista si ya no es usuario. */}
                    {deal.assignedUserId && !team.some((m) => m.id === deal.assignedUserId) && (
                      <option value={deal.assignedUserId}>Usuario dado de baja</option>
                    )}
                  </select>
                </div>

                <div className="grid grid-cols-[1fr_100px] gap-3">
                  <div>
                    <label className={labelClass} htmlFor="value">
                      Valor
                    </label>
                    <input
                      id="value"
                      name="value"
                      inputMode="decimal"
                      defaultValue={deal.value ?? ""}
                      placeholder="Opcional"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass} htmlFor="currency">
                      Moneda
                    </label>
                    <select id="currency" name="currency" defaultValue={deal.currency} className={inputClass}>
                      <option value="USD">USD</option>
                      <option value="ARS">ARS</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelClass} htmlFor="notes">
                  Notas
                </label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={3}
                  defaultValue={deal.notes ?? ""}
                  className="mt-1.5 w-full rounded-lg border border-line bg-field px-3 py-2 text-[14px] text-ink focus:border-primary focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="inline-flex h-9 w-fit items-center rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover"
              >
                Guardar cambios
              </button>
            </form>
          </Card>

          <DealPropertiesPanel dealId={dealId} linked={linked} linkable={linkable} />

          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <CalendarClock className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Visitas</h2>
              <Link
                href={`/visitas?nueva=1&deal=${dealId}`}
                className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
              >
                <Plus className="size-4" strokeWidth={2} />
                Nueva visita
              </Link>
            </div>
            {visits.length === 0 ? (
              <p className="px-5 py-5 text-[13px] text-muted">
                Sin visitas todavía. Una oportunidad puede acumular varias, incluso a propiedades distintas.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {visits.map((v) => (
                  <VisitCard key={v.id} visit={v} team={team} back={`/pipeline/${dealId}`} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <History className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Historial</h2>
            </div>
            {events.length === 0 ? (
              <p className="px-5 py-5 text-[13px] text-muted">Sin movimientos todavía.</p>
            ) : (
              <ul className="divide-y divide-line">
                {events.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <span className="flex-1 text-ink">
                      {ACTION_LABEL[e.action] ?? e.action}
                      {e.action === "etapa" && e.fromValue && e.toValue && (
                        <span className="text-muted">
                          {" "}
                          · {STAGE_LABEL[e.fromValue as keyof typeof STAGE_LABEL] ?? e.fromValue} →{" "}
                          {STAGE_LABEL[e.toValue as keyof typeof STAGE_LABEL] ?? e.toValue}
                        </span>
                      )}
                      {e.action === "responsable" && (
                        <span className="text-muted"> · {memberLabel(team, e.toValue)}</span>
                      )}
                      {e.action === "perdida" && e.toValue && <span className="text-muted"> · {e.toValue}</span>}
                    </span>
                    <span className="shrink-0 text-[11.5px] text-muted">{formatListDate(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-ink">Etapa</h2>
            <StageSelect dealId={dealId} stage={deal.stage} className="mt-3" />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              {closed
                ? "Mover la etapa vuelve a abrir la oportunidad."
                : "El tablero muestra solo las oportunidades abiertas."}
            </p>

            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4 text-[13px]">
              <div className="flex justify-between gap-3">
                <span className="text-muted">Responsable</span>
                <span className="truncate text-ink">{memberLabel(team, deal.assignedUserId)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Creada</span>
                <span className="text-ink">{formatListDate(deal.createdAt)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted">Última actualización</span>
                <span className="text-ink">{formatListDate(deal.updatedAt)}</span>
              </div>
            </div>

            {deal.conversationId && (
              <Link
                href={`/conversaciones/${deal.conversationId}`}
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
              >
                <MessageCircle className="size-4" strokeWidth={1.7} />
                Ver la conversación
              </Link>
            )}
          </Card>

          {deal.requirement && (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-muted" strokeWidth={1.7} />
                <h2 className="text-[15px] font-semibold text-ink">Qué busca</h2>
              </div>
              <p className="mt-1 text-[12px] text-muted">Extraído de la conversación por el agente.</p>
              <dl className="mt-3 flex flex-col gap-2 text-[13px]">
                {deal.requirement.operation && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Operación</dt>
                    <dd className="text-ink">{deal.requirement.operation}</dd>
                  </div>
                )}
                {deal.requirement.zones.length > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted">Zonas</dt>
                    <dd className="truncate text-right text-ink">{deal.requirement.zones.join(", ")}</dd>
                  </div>
                )}
                {(deal.requirement.priceMin !== null || deal.requirement.priceMax !== null) && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Presupuesto</dt>
                    <dd className="text-ink">
                      {deal.requirement.currency}{" "}
                      {deal.requirement.priceMin?.toLocaleString("es-AR") ?? "—"} a{" "}
                      {deal.requirement.priceMax?.toLocaleString("es-AR") ?? "—"}
                    </dd>
                  </div>
                )}
                {deal.requirement.bedroomsMin !== null && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Dormitorios</dt>
                    <dd className="text-ink">{deal.requirement.bedroomsMin}+</dd>
                  </div>
                )}
                {deal.requirement.mustHave.length > 0 && (
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted">Imprescindible</dt>
                    <dd className="truncate text-right text-ink">{deal.requirement.mustHave.join(", ")}</dd>
                  </div>
                )}
              </dl>
            </Card>
          )}

          {!deal.requirement && (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Target className="size-4 text-muted" strokeWidth={1.7} />
                <h2 className="text-[15px] font-semibold text-ink">Qué busca</h2>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
                Sin perfil cargado. Lo completa el agente cuando extrae los requisitos de la conversación.
              </p>
            </Card>
          )}

          <CloseDealPanel dealId={dealId} status={deal.status} stageLabel={STAGE_LABEL[deal.stage]} />

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Propiedades</h2>
            </div>
            <p className="mt-2 text-[13px] text-muted">
              {linked.length === 0
                ? "Ninguna vinculada todavía."
                : `${linked.length} propiedad${linked.length === 1 ? "" : "es"} de interés.`}
            </p>
          </Card>
        </div>
      </div>
    </>
  );
}
