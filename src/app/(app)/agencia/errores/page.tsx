import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listOrganizations } from "@/lib/agency/queries";
import { requireAgencyAdmin } from "@/lib/auth";
import { formatListDate } from "@/lib/format";
import { INCIDENT_MODULES, listIncidents, MODULE_LABEL } from "@/lib/incidents/report";
import type { IncidentStatus } from "@/db/schema";
import { retryIncident, updateIncident } from "../actions";
import { cn } from "@/lib/utils";

export const metadata = { title: "Errores y logs · Setter CRM" };

const STATUSES: IncidentStatus[] = ["nuevo", "en_revision", "resuelto"];
const STATUS_LABEL: Record<IncidentStatus, string> = {
  nuevo: "Nuevo",
  en_revision: "En revisión",
  resuelto: "Resuelto",
};

const SEVERITY = {
  error: { icon: AlertTriangle, tone: "text-accent-red", chip: "bg-accent-red/10 text-accent-red" },
  advertencia: { icon: AlertTriangle, tone: "text-accent-amber", chip: "bg-accent-amber/12 text-accent-amber" },
  info: { icon: Info, tone: "text-muted", chip: "bg-field text-muted" },
} as const;

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors",
        active ? "bg-primary text-white" : "border border-line bg-card text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export default async function ErroresPage({ searchParams }: PageProps<"/agencia/errores">) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");

  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const status = STATUSES.includes(one("estado") as IncidentStatus) ? (one("estado") as IncidentStatus) : undefined;
  const moduleFilter = INCIDENT_MODULES.includes(one("modulo") as never) ? one("modulo") : undefined;
  const cliente = one("cliente");

  const [incidents, orgs] = await Promise.all([
    listIncidents({ status, module: moduleFilter, organizationId: cliente }),
    listOrganizations(),
  ]);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { estado: status, modulo: moduleFilter, cliente, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/agencia/errores?${s}` : "/agencia/errores";
  };

  const abiertos = incidents.filter((i) => i.status !== "resuelto").length;

  return (
    <>
      <PageHeader
        title="Errores y logs"
        subtitle={`${abiertos} sin resolver de ${incidents.length} en pantalla`}
      />

      <div className="mb-5 flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-1.5">
          <Chip href={qs({ estado: undefined })} active={!status}>
            Todos
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} href={qs({ estado: s })} active={status === s}>
              {STATUS_LABEL[s]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Chip href={qs({ modulo: undefined })} active={!moduleFilter}>
            Todo módulo
          </Chip>
          {INCIDENT_MODULES.map((m) => (
            <Chip key={m} href={qs({ modulo: m })} active={moduleFilter === m}>
              {MODULE_LABEL[m]}
            </Chip>
          ))}
        </div>
        {orgs.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <Chip href={qs({ cliente: undefined })} active={!cliente}>
              Todo cliente
            </Chip>
            {orgs.map((o) => (
              <Chip key={o.id} href={qs({ cliente: o.id })} active={cliente === o.id}>
                {o.name}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {incidents.length === 0 ? (
        <Card>
          <EmptyState
            icon={CheckCircle2}
            title="Nada que resolver"
            description="Acá aparecen los problemas de sincronización, envío de mensajes, respuestas del agente y webhooks, con su detalle y la opción de reintentar."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {incidents.map((incident) => {
            const sev = SEVERITY[incident.severity];
            const SevIcon = sev.icon;
            return (
              <Card key={incident.id} className="p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <SevIcon className={cn("mt-0.5 size-4 shrink-0", sev.tone)} strokeWidth={1.8} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("rounded-md px-2 py-0.5 text-[11.5px] font-medium", sev.chip)}>
                        {MODULE_LABEL[incident.module as keyof typeof MODULE_LABEL] ?? incident.module}
                      </span>
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[11.5px] font-medium",
                          incident.status === "resuelto"
                            ? "bg-accent-green/12 text-accent-green"
                            : incident.status === "en_revision"
                              ? "bg-accent-blue/12 text-accent-blue"
                              : "bg-field text-muted",
                        )}
                      >
                        {STATUS_LABEL[incident.status]}
                      </span>
                      {incident.organizationName && (
                        <span className="text-[12px] text-muted">{incident.organizationName}</span>
                      )}
                      {incident.occurrences > 1 && (
                        <span className="rounded-md bg-field px-2 py-0.5 text-[11.5px] text-muted">
                          {incident.occurrences} veces
                        </span>
                      )}
                    </div>

                    <p className="mt-1.5 text-[14px] font-medium text-ink">{incident.message}</p>

                    {incident.detail && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[12.5px] text-muted hover:text-ink">
                          Detalle técnico
                        </summary>
                        <pre className="mt-1.5 overflow-x-auto rounded-lg bg-field px-3 py-2 text-[12px] text-ink">
                          {incident.detail}
                        </pre>
                      </details>
                    )}

                    <p className="mt-1.5 text-[12px] text-muted">
                      Primera vez {formatListDate(incident.firstSeenAt)} · última{" "}
                      {formatListDate(incident.lastSeenAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    {/* El reintento solo aparece cuando es seguro repetir la operación. */}
                    {incident.retryTarget && incident.status !== "resuelto" && (
                      <form action={retryIncident}>
                        <input type="hidden" name="incidentId" value={incident.id} />
                        <input type="hidden" name="organizationId" value={incident.organizationId ?? ""} />
                        <input type="hidden" name="retryTarget" value={incident.retryTarget} />
                        <button
                          type="submit"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink hover:bg-field"
                        >
                          <RefreshCw className="size-3.5" strokeWidth={1.7} />
                          Reintentar
                        </button>
                      </form>
                    )}
                    {incident.status !== "en_revision" && incident.status !== "resuelto" && (
                      <form action={updateIncident}>
                        <input type="hidden" name="incidentId" value={incident.id} />
                        <input type="hidden" name="status" value="en_revision" />
                        <button
                          type="submit"
                          className="inline-flex h-8 items-center rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink hover:bg-field"
                        >
                          En revisión
                        </button>
                      </form>
                    )}
                    {incident.status !== "resuelto" && (
                      <form action={updateIncident}>
                        <input type="hidden" name="incidentId" value={incident.id} />
                        <input type="hidden" name="status" value="resuelto" />
                        <button
                          type="submit"
                          className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-[12.5px] font-medium text-white hover:bg-primary-hover"
                        >
                          Resolver
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
