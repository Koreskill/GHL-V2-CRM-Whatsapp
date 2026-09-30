import Link from "next/link";
import { Building2, CircleUser, Plus, Trophy, XCircle } from "lucide-react";
import { PipelineBoard } from "@/components/pipeline/pipeline-board";
import { StageSelect } from "@/components/pipeline/stage-select";
import { ContactTagsBar } from "@/components/tags/contact-tags-bar";
import { Button, Card } from "@/components/ui/primitives";
import { requireOrgId } from "@/lib/auth";
import { listBoardDeals, listClosedDeals } from "@/lib/deals/queries";
import { listTeam, memberLabel } from "@/lib/deals/team";
import { getContactTagSummaries } from "@/lib/crm/tags";
import { formatListDate } from "@/lib/format";
import { getOrganization } from "@/lib/agency/queries";
import { DEAL_STAGES } from "@/lib/pipeline";
import { resolveStageColors } from "@/lib/pipeline-colors";

export const metadata = { title: "Pipeline · Setter CRM" };

const money = (value: number | null, currency: string) =>
  value === null ? null : `${currency} ${value.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

export default async function PipelinePage() {
  const orgId = await requireOrgId();
  const [open, closed, team, org] = await Promise.all([
    listBoardDeals(orgId),
    listClosedDeals(orgId),
    listTeam(orgId),
    getOrganization(orgId),
  ]);
  const colors = resolveStageColors(org?.metadata);
  const tagsByContact = await getContactTagSummaries(open.map((d) => d.contactId), orgId);

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

      <PipelineBoard
        // Al cambiar los datos del servidor el tablero se reinicia con el estado real.
        key={open.map((d) => d.id + d.stage).join(",")}
        colors={colors}
        cards={open.map((d) => ({ id: d.id, stage: d.stage, value: d.value }))}
        bodies={Object.fromEntries(
          open.map((d) => [
            d.id,
            <>
              <Link href={`/pipeline/${d.id}`} className="block">
                <p className="truncate text-[13.5px] font-semibold text-ink hover:underline">{d.title}</p>
                <p className="mt-0.5 truncate text-[12px] text-muted">{d.contactName}</p>
              </Link>

              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                {d.value !== null && <span className="font-medium tabular-nums text-ink">{money(d.value, d.currency)}</span>}
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

              <div className="mt-1.5">
                <ContactTagsBar summary={tagsByContact.get(d.contactId) ?? null} compact />
              </div>

              {d.lastInteractionAt && (
                <p className="mt-1 text-[11px] text-muted">Última interacción {formatListDate(d.lastInteractionAt)}</p>
              )}

              <StageSelect dealId={d.id} stage={d.stage} className="mt-2.5" />
            </>,
          ]),
        )}
      />

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
