import Link from "next/link";
import { Building2, CircleUser, Plus, Trophy, XCircle } from "lucide-react";
import { StageSelect } from "@/components/pipeline/stage-select";
import { Button, Card } from "@/components/ui/primitives";
import { requireOrgId } from "@/lib/auth";
import { listBoardDeals, listClosedDeals } from "@/lib/deals/queries";
import { listTeam, memberLabel } from "@/lib/deals/team";
import { formatListDate } from "@/lib/format";
import { DEAL_STAGES } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

export const metadata = { title: "Pipeline · Setter CRM" };

const money = (value: number | null, currency: string) =>
  value === null ? null : `${currency} ${value.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

export default async function PipelinePage() {
  const orgId = await requireOrgId();
  const [open, closed, team] = await Promise.all([
    listBoardDeals(orgId),
    listClosedDeals(orgId),
    listTeam(orgId),
  ]);

  const totalValue = open.reduce((sum, d) => sum + (d.value ?? 0), 0);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-[20px] font-bold text-ink">Pipeline principal</h1>
        <span className="text-[13px] text-muted">
          {open.length} oportunidad{open.length === 1 ? "" : "es"} abierta{open.length === 1 ? "" : "s"}
          {totalValue > 0 && ` · USD ${totalValue.toLocaleString("es-AR", { maximumFractionDigits: 0 })} en valor cargado`}
        </span>
        <div className="ml-auto">
          <Link href="/pipeline/nueva">
            <Button>
              <Plus className="size-4" strokeWidth={2} />
              Nueva oportunidad
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3">
        {DEAL_STAGES.map((stage) => {
          const cards = open.filter((d) => d.stage === stage.id);
          const stageValue = cards.reduce((sum, d) => sum + (d.value ?? 0), 0);
          return (
            <Card key={stage.id} className="flex w-72 shrink-0 flex-col p-4">
              <div className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", stage.dot)} />
                <h2 className="text-[14px] font-semibold text-ink">{stage.label}</h2>
                <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">
                  {cards.length}
                </span>
              </div>
              <p className="mt-1 text-[12px] text-muted">
                {stageValue > 0
                  ? `USD ${stageValue.toLocaleString("es-AR", { maximumFractionDigits: 0 })} en valor cargado`
                  : "Sin valor cargado"}
              </p>

              {cards.length === 0 ? (
                <div className="mt-4 grid flex-1 place-items-center rounded-xl border border-dashed border-line py-10">
                  <p className="text-[13px] text-muted">Sin deals en esta etapa</p>
                </div>
              ) : (
                <ul className="mt-4 flex flex-1 flex-col gap-2.5 overflow-y-auto">
                  {cards.map((d) => (
                    <li key={d.id} className="rounded-xl border border-line bg-canvas/40 p-3">
                      <Link href={`/pipeline/${d.id}`} className="block">
                        <p className="truncate text-[13.5px] font-semibold text-ink hover:underline">{d.title}</p>
                        <p className="mt-0.5 truncate text-[12px] text-muted">{d.contactName}</p>
                      </Link>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                        {d.value !== null && (
                          <span className="font-medium tabular-nums text-ink">{money(d.value, d.currency)}</span>
                        )}
                        {d.propertyCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="size-3" strokeWidth={1.8} />
                            {d.propertyCount}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 truncate">
                          <CircleUser className="size-3" strokeWidth={1.8} />
                          {memberLabel(team, d.assignedUserId).split("@")[0]}
                        </span>
                      </div>

                      {d.lastInteractionAt && (
                        <p className="mt-1 text-[11px] text-muted">
                          Última interacción {formatListDate(d.lastInteractionAt)}
                        </p>
                      )}

                      <StageSelect dealId={d.id} stage={d.stage} className="mt-2.5" />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>

      {closed.length > 0 && (
        <Card className="mt-5 shrink-0">
          <div className="border-b border-line px-5 py-3.5">
            <h2 className="text-[14px] font-semibold text-ink">Cerradas</h2>
            <p className="text-[12px] text-muted">
              Las perdidas conservan la etapa en la que se cayeron, para ver dónde se traban las ventas.
            </p>
          </div>
          <ul className="max-h-52 divide-y divide-line overflow-y-auto">
            {closed.map((d) => {
              const won = d.status === "ganada";
              return (
                <li key={d.id}>
                  <Link href={`/pipeline/${d.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-field">
                    {won ? (
                      <Trophy className="size-4 shrink-0 text-accent-green" strokeWidth={1.7} />
                    ) : (
                      <XCircle className="size-4 shrink-0 text-muted" strokeWidth={1.7} />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{d.title}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {d.contactName}
                        {!won && d.lostReason && ` · ${d.lostReason}`}
                      </span>
                    </span>
                    {!won && (
                      <span className="shrink-0 rounded-md bg-field px-2 py-0.5 text-[11.5px] text-muted">
                        Cayó en {DEAL_STAGES.find((s) => s.id === d.stage)?.label}
                      </span>
                    )}
                    <span className="shrink-0 text-[11.5px] text-muted">{formatListDate(d.updatedAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
