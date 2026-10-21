import Link from "next/link";
import { AlertTriangle, Building2, Lock, LockOpen, Plus, RefreshCw, Search, Settings } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getSession, requireOrgId } from "@/lib/auth";
import { formatListDate } from "@/lib/format";
import { countCatalog, getSyncConfig, listCatalog, listZones, type PropertyFilters } from "@/lib/properties/catalog";
import { cn } from "@/lib/utils";
import { PropertyCover } from "@/components/properties/property-cover";
import { SheetCheck, SheetRequirements } from "@/components/properties/sheet-help";
import { formatMoney, placeLine, summaryParts, tidyName } from "@/lib/properties/organize";
import { PROPERTY_STATUSES, statusLabel, statusTone } from "@/lib/properties/status";
import { analyzeOwnSheet, syncOwnProperties } from "./actions";

export const metadata = { title: "Propiedades · Setter CRM" };

const OPERATIONS = [
  { id: "venta", label: "Venta" },
  { id: "alquiler", label: "Alquiler" },
  { id: "temporario", label: "Temporario" },
];
const TYPES = ["departamento", "casa", "ph", "terreno", "local", "oficina", "cochera", "otro"];
const STATUSES: readonly string[] = PROPERTY_STATUSES;

const money = (v: number | null, c: string) => formatMoney(v, c) ?? "Sin precio";

function parse(params: Record<string, string | string[] | undefined>): PropertyFilters {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const nums = (k: string) => {
    const v = Number(one(k));
    return Number.isFinite(v) && v >= 0 ? v : undefined;
  };
  return {
    q: one("q")?.slice(0, 120),
    operation: OPERATIONS.some((o) => o.id === one("operacion")) ? one("operacion") : undefined,
    propertyType: TYPES.includes(one("tipo") ?? "") ? one("tipo") : undefined,
    status: STATUSES.includes(one("estado") ?? "") ? one("estado") : undefined,
    zone: one("zona")?.slice(0, 80),
    priceMin: nums("min"),
    priceMax: nums("max"),
  };
}

function qs(base: PropertyFilters, patch: Partial<Record<string, string | undefined>>) {
  const p = new URLSearchParams();
  const current: Record<string, string | undefined> = {
    q: base.q,
    operacion: base.operation,
    tipo: base.propertyType,
    estado: base.status,
    zona: base.zone,
    min: base.priceMin?.toString(),
    max: base.priceMax?.toString(),
    ...patch,
  };
  for (const [k, v] of Object.entries(current)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `/propiedades?${s}` : "/propiedades";
}

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

export default async function PropiedadesPage({ searchParams }: PageProps<"/propiedades">) {
  const orgId = await requireOrgId();
  const isAdmin = (await getSession())?.role === "admin";
  const params = await searchParams;
  const filters = parse(params);

  const [items, total, zones, sync] = await Promise.all([
    listCatalog(orgId, filters),
    countCatalog(orgId, filters),
    listZones(orgId),
    getSyncConfig(orgId),
  ]);

  return (
    <>
      <PageHeader
        title="Propiedades"
        subtitle={`${total} ${total === 1 ? "propiedad" : "propiedades"} en la cartera`}
        actions={
          <>
            {sync && (
              <form action={syncOwnProperties}>
                <button
                  type="submit"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
                >
                  <RefreshCw className="size-4" strokeWidth={1.7} />
                  Sincronizar
                </button>
              </form>
            )}
            {isAdmin && (
              <Link
                href="/propiedades/fuente"
                title="Configurar la hoja de propiedades"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[13.5px] font-medium text-ink hover:bg-field"
              >
                <Settings className="size-4" strokeWidth={1.7} />
                <span className="sr-only">Configurar la hoja de propiedades</span>
              </Link>
            )}
            <Link
              href="/propiedades/nueva"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover"
            >
              <Plus className="size-4" strokeWidth={2} />
              Nueva propiedad
            </Link>
          </>
        }
      />

      {/* Estado de la sincronización: la hoja es la fuente, el CRM la refleja. */}
      <Card className={cn("mb-5 p-4", sync?.lastStatus === "error" && "border-accent-red/40 bg-accent-red/5")}>
        <div className="flex flex-wrap items-center gap-3">
          <RefreshCw
            className={cn("size-4 shrink-0", sync?.lastStatus === "error" ? "text-accent-red" : "text-muted")}
            strokeWidth={1.7}
          />
          <p className="min-w-0 flex-1 text-[13px] text-ink">
            {!sync ? (
              <>
                Sin hoja de Google configurada. La cartera se edita en la hoja y el CRM la refleja: pedile al
                administrador de la agencia que la conecte.
              </>
            ) : sync.lastStatus === "error" ? (
              <>
                La última sincronización falló: <span className="text-accent-red">{sync.lastError}</span>
              </>
            ) : sync.lastRunAt ? (
              <>
                Última sincronización {formatListDate(sync.lastRunAt)} · {sync.lastRowsUpserted ?? 0} actualizadas
                {(sync.lastRowsSkipped ?? 0) > 0 && ` · ${sync.lastRowsSkipped} omitidas`}
              </>
            ) : (
              <>Hoja conectada, todavía sin sincronizar.</>
            )}
          </p>
        </div>
        {sync && <SheetCheck action={analyzeOwnSheet} />}
        <SheetRequirements />
      </Card>

      <div className="mb-5 flex flex-col gap-3">
        <form action="/propiedades" className="flex flex-wrap items-center gap-2">
          {filters.operation && <input type="hidden" name="operacion" value={filters.operation} />}
          {filters.propertyType && <input type="hidden" name="tipo" value={filters.propertyType} />}
          {filters.status && <input type="hidden" name="estado" value={filters.status} />}
          {filters.zone && <input type="hidden" name="zona" value={filters.zone} />}
          <label className="flex h-9 w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-card px-3 text-muted">
            <Search className="size-4" strokeWidth={1.8} />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Buscar por título, zona, dirección o property_id"
              className="h-full w-full bg-transparent text-[13.5px] text-ink outline-none placeholder:text-muted"
            />
          </label>
          <input
            name="min"
            inputMode="numeric"
            defaultValue={filters.priceMin ?? ""}
            placeholder="Precio mín."
            className="h-9 w-32 rounded-lg border border-line bg-card px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none"
          />
          <input
            name="max"
            inputMode="numeric"
            defaultValue={filters.priceMax ?? ""}
            placeholder="Precio máx."
            className="h-9 w-32 rounded-lg border border-line bg-card px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-9 items-center rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            Filtrar
          </button>
        </form>

        <div className="flex flex-wrap gap-1.5">
          <Chip href={qs(filters, { operacion: undefined })} active={!filters.operation}>
            Toda operación
          </Chip>
          {OPERATIONS.map((o) => (
            <Chip key={o.id} href={qs(filters, { operacion: o.id })} active={filters.operation === o.id}>
              {o.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Chip href={qs(filters, { estado: undefined })} active={!filters.status}>
            Vigentes
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s} href={qs(filters, { estado: s })} active={filters.status === s}>
              {statusLabel(s)}
            </Chip>
          ))}
        </div>

        {zones.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <Chip href={qs(filters, { zona: undefined })} active={!filters.zone}>
              Toda zona
            </Chip>
            {zones.slice(0, 14).map((z) => (
              <Chip key={z} href={qs(filters, { zona: z })} active={filters.zone === z}>
                {z}
              </Chip>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title={total === 0 ? "La cartera está vacía" : "Ninguna propiedad coincide"}
            description={
              total === 0
                ? "Las propiedades se cargan en la hoja de Google y el CRM las refleja al sincronizar."
                : "Prueba con otros filtros."
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => (
            <Link key={p.id} href={`/propiedades/${p.id}`}>
              <Card
                className={cn(
                  "flex h-full flex-col overflow-hidden transition-colors",
                  p.networkShared
                    ? "border-accent-green/50 bg-accent-green/5 hover:border-accent-green"
                    : "border-accent-red/40 bg-accent-red/5 hover:border-accent-red/70",
                )}
              >
                <PropertyCover src={p.coverUrl}>
                  <span
                    className={cn(
                      "absolute left-2.5 top-2.5 rounded-md px-2 py-0.5 text-[11.5px] font-semibold backdrop-blur-sm",
                      statusTone(p.status),
                    )}
                  >
                    {statusLabel(p.status)}
                  </span>
                  <span
                    title={p.networkShared ? "Se muestra en la red" : "No se muestra en la red"}
                    className={cn(
                      "absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold text-white",
                      p.networkShared ? "bg-accent-green" : "bg-accent-red",
                    )}
                  >
                    {p.networkShared ? <LockOpen className="size-3" strokeWidth={2.2} /> : <Lock className="size-3" strokeWidth={2.2} />}
                    {p.networkShared ? "En la red" : "Fuera de la red"}
                  </span>
                  {p.syncIssues.length > 0 && (
                    <span
                      title={p.syncIssues.join(" · ")}
                      className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1 rounded-md bg-accent-amber/90 px-2 py-0.5 text-[11.5px] font-medium text-white"
                    >
                      <AlertTriangle className="size-3" strokeWidth={2} />
                      {p.syncIssues.length}
                    </span>
                  )}
                </PropertyCover>

                <div className="flex flex-1 flex-col p-4">
                  <p className="truncate text-[14.5px] font-semibold text-ink">{tidyName(p.title) ?? "Sin título"}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-muted">
                    {p.operation} · {p.propertyType}
                    {placeLine(p.zone, p.city) ? ` · ${placeLine(p.zone, p.city)}` : ""}
                  </p>
                  <p className="mt-2 text-[15px] font-bold tabular-nums text-ink">{money(p.price, p.currency)}</p>

                  <p className="mt-1.5 flex min-h-4 flex-wrap gap-x-2.5 text-[12px] text-muted">
                    {summaryParts(p).map((part) => (
                      <span key={part}>{part}</span>
                    ))}
                  </p>

                  {(p.deals > 0 || p.visits > 0) && (
                    <p className="mt-auto pt-2.5 text-[12px] text-muted">
                      {p.deals > 0 && `${p.deals} oportunidad${p.deals === 1 ? "" : "es"}`}
                      {p.deals > 0 && p.visits > 0 && " · "}
                      {p.visits > 0 && `${p.visits} visita${p.visits === 1 ? "" : "s"}`}
                    </p>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
