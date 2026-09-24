import { CalendarClock, GitBranch, History, Plus } from "lucide-react";
import { NewVisitForm } from "@/components/visits/new-visit-form";
import { VisitCard, VISIT_LABEL, VISIT_TONE } from "@/components/visits/visit-card";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireOrgId } from "@/lib/auth";
import { listTeam } from "@/lib/deals/team";
import { formatListDate } from "@/lib/format";
import { countVisits, listVisitHistory, listVisitsByStatus, listVisitTargets } from "@/lib/visits/queries";
import { cn } from "@/lib/utils";
import Link from "next/link";

export const metadata = { title: "Visitas · Setter CRM" };

export default async function VisitasPage({ searchParams }: PageProps<"/visitas">) {
  const orgId = await requireOrgId();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error.slice(0, 300) : null;
  const creating = params.nueva === "1";
  const defaultDealId = typeof params.deal === "string" ? params.deal : null;

  const [agendadas, solicitadas, history, targets, team, counts] = await Promise.all([
    listVisitsByStatus(orgId, ["agendada"]),
    listVisitsByStatus(orgId, ["solicitada"]),
    listVisitHistory(orgId),
    listVisitTargets(orgId),
    listTeam(orgId),
    countVisits(orgId),
  ]);

  const back = "/visitas";

  return (
    <>
      <PageHeader
        title="Visitas"
        subtitle={`${counts.agendadas} agendada${counts.agendadas === 1 ? "" : "s"} · ${counts.solicitadas} por coordinar · ${counts.proximas} en los próximos 7 días`}
        actions={
          <Link
            href={creating ? "/visitas" : "/visitas?nueva=1"}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-medium transition-colors",
              creating
                ? "border border-line bg-card text-ink hover:bg-field"
                : "bg-primary text-white hover:bg-primary-hover",
            )}
          >
            <Plus className="size-4" strokeWidth={2} />
            {creating ? "Cerrar" : "Nueva visita"}
          </Link>
        }
      />

      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      {creating && (
        <Card className="mb-5 max-w-2xl p-6">
          {targets.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title="No hay oportunidades con propiedades"
              description="Una visita es siempre a una propiedad dentro de una oportunidad. Crea una oportunidad en Pipeline y vinculale al menos una propiedad."
            />
          ) : (
            <NewVisitForm targets={targets} team={team} back={back} defaultDealId={defaultDealId} />
          )}
        </Card>
      )}

      <div className="flex flex-col gap-5">
        <Card>
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <h2 className="text-[17px] font-semibold text-ink">Visitas coordinadas</h2>
            <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">
              {agendadas.length}
            </span>
            <span className="text-[13px] text-muted">Con fecha y hora confirmada</span>
          </div>
          {agendadas.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No hay visitas coordinadas"
              description="Cuando confirmes fecha con el cliente, la visita aparece acá."
            />
          ) : (
            <ul className="divide-y divide-line">
              {agendadas.map((v) => (
                <VisitCard key={v.id} visit={v} team={team} back={back} />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <h2 className="text-[17px] font-semibold text-ink">En proceso de coordinación</h2>
            <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">
              {solicitadas.length}
            </span>
            <span className="text-[13px] text-muted">Pedidas, sin fecha confirmada</span>
          </div>
          {solicitadas.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="No hay visitas en coordinación"
              description="Pedir una visita no es tenerla agendada: las que están sin fecha aparecen acá hasta que se confirme."
            />
          ) : (
            <ul className="divide-y divide-line">
              {solicitadas.map((v) => (
                <VisitCard key={v.id} visit={v} team={team} back={back} />
              ))}
            </ul>
          )}
        </Card>

        {history.length > 0 && (
          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <History className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[17px] font-semibold text-ink">Historial</h2>
              <span className="text-[13px] text-muted">Realizadas, no asistió y canceladas</span>
            </div>
            <ul className="divide-y divide-line">
              {history.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-medium", VISIT_TONE[v.status])}>
                    {VISIT_LABEL[v.status]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{v.propertyTitle}</span>
                    <span className="block truncate text-[12px] text-muted">
                      {v.contactName}
                      {v.notes ? ` · ${v.notes}` : ""}
                      {v.cancelReason ? ` · ${v.cancelReason}` : ""}
                    </span>
                  </span>
                  <Link
                    href={`/pipeline/${v.dealId}`}
                    className="shrink-0 text-[12px] text-muted hover:text-ink hover:underline"
                  >
                    {v.dealTitle}
                  </Link>
                  <span className="shrink-0 text-[12px] text-muted">
                    {v.completedAt ? formatListDate(v.completedAt) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
