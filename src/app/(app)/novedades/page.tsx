import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { MonthGrid, ScopeLabel, TypeChip, WeekView, whenLabel } from "@/components/news/parts";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getSession } from "@/lib/auth";
import { listOrganizations } from "@/lib/agency/queries";
import { EVENT_TYPES, EVENT_TYPE_LABEL, addDays, canManage, dayKey, monthGrid, occurrencesIn, startOfDay, weekStart, type Scope } from "@/lib/news/logic";
import { listVisibleEvents, viewerFor } from "@/lib/news/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Novedades · Setter CRM" };

const SCOPE_PARAM: Record<string, Scope> = { red: "network", interno: "internal", cliente: "client" };
const MONTHS = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", month: "long", year: "numeric" });
const isMonth = (v: unknown): v is string => typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const isDay = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function shiftMonth(month: string, n: number) {
  const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export default async function NovedadesPage({ searchParams }: PageProps<"/novedades">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const viewer = await viewerFor(session);
  const sp = await searchParams;

  const now = new Date();
  const today = dayKey(now);
  const view = str(sp.vista) === "semana" ? "semana" : "mes";
  const month = isMonth(sp.mes) ? sp.mes : today.slice(0, 7);
  const date = isDay(sp.fecha) ? sp.fecha : today;
  const ambito = str(sp.ambito) && SCOPE_PARAM[str(sp.ambito)!] ? str(sp.ambito)! : "todo";
  const tipo = EVENT_TYPES.find((t) => t === str(sp.tipo));
  // Solo el equipo interno puede acotar por cliente; para el resto el parámetro no hace nada.
  const clientId = viewer.isAgencyAdmin && !viewer.acting && str(sp.cliente) && /^[0-9a-f-]{36}$/i.test(str(sp.cliente)!) ? str(sp.cliente) : undefined;

  const days = monthGrid(month);
  const from = view === "mes" ? startOfDay(days[0]) : startOfDay(weekStart(date));
  const to = view === "mes" ? startOfDay(addDays(days[days.length - 1], 1)) : startOfDay(addDays(weekStart(date), 7));
  const filters = { scope: SCOPE_PARAM[ambito], type: tipo, clientId: ambito === "cliente" || clientId ? clientId : undefined };

  const [events, upcomingEvents] = await Promise.all([
    listVisibleEvents(viewer, from, to, filters),
    listVisibleEvents(viewer, now, new Date(now.getTime() + 60 * 86_400_000), filters),
  ]);
  const occurrences = occurrencesIn(events, from, to);
  const upcoming = occurrencesIn(upcomingEvents, now, new Date(now.getTime() + 60 * 86_400_000)).slice(0, 8);

  const orgNames = viewer.isAgencyAdmin ? new Map((await listOrganizations()).map((o) => [o.id, o.name])) : new Map<string, string>();

  const hrefFor = (q: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = { vista: view, mes: view === "mes" ? month : undefined, fecha: view === "semana" ? date : undefined, ambito: ambito === "todo" ? undefined : ambito, tipo, cliente: clientId, ...q };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/novedades?${qs}` : "/novedades";
  };

  const scopeChips: [string, string][] = [["todo", "Todo"], ["red", "Red"], ...(viewer.isAgencyAdmin ? ([["interno", "Interno"], ["cliente", "Cliente"]] as [string, string][]) : [])];
  const prev = view === "mes" ? hrefFor({ mes: shiftMonth(month, -1) }) : hrefFor({ fecha: addDays(date, -7) });
  const next = view === "mes" ? hrefFor({ mes: shiftMonth(month, 1) }) : hrefFor({ fecha: addDays(date, 7) });
  const title = view === "mes" ? MONTHS.format(new Date(`${month}-15T12:00:00Z`)) : `Semana del ${weekStart(date).split("-").reverse().join("/")}`;

  return (
    <>
      <PageHeader
        title="Novedades"
        subtitle="Calendario, actividades, recordatorios y anuncios"
        actions={
          canManage(viewer) && (
            <Link href="/novedades/nuevo" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover">
              <Plus className="size-4" strokeWidth={2} /> Nuevo evento
            </Link>
          )
        }
      />
      {sp.eliminado === "1" && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-accent-green">Evento eliminado.</p>}
      {viewer.acting && <p className="mb-4 text-[12.5px] text-muted">Estás viendo las novedades de este cliente: lo de su red y lo interno asociado a él.</p>}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {scopeChips.map(([id, label]) => (
            <Link key={id} href={hrefFor({ ambito: id === "todo" ? undefined : id })} className={cn("inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium", ambito === id ? "bg-primary text-white" : "border border-line bg-card text-muted hover:text-ink")}>
              {label}
            </Link>
          ))}
        </div>
        <form action="/novedades" className="flex items-center gap-2">
          <input type="hidden" name="vista" value={view} />
          {view === "mes" ? <input type="hidden" name="mes" value={month} /> : <input type="hidden" name="fecha" value={date} />}
          {ambito !== "todo" && <input type="hidden" name="ambito" value={ambito} />}
          {clientId && <input type="hidden" name="cliente" value={clientId} />}
          <select name="tipo" defaultValue={tipo ?? ""} className="h-8 rounded-lg border border-line bg-card px-2 text-[12.5px] text-ink">
            <option value="">Todos los tipos</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <button type="submit" className="h-8 rounded-lg border border-line px-3 text-[12.5px] text-ink hover:bg-field">
            Filtrar
          </button>
        </form>
        <div className="ml-auto flex items-center gap-1.5">
          <Link href={hrefFor({ vista: "mes", mes: today.slice(0, 7), fecha: undefined })} className={cn("inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium", view === "mes" ? "bg-field text-ink" : "text-muted hover:text-ink")}>
            Mes
          </Link>
          <Link href={hrefFor({ vista: "semana", fecha: today, mes: undefined })} className={cn("inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium", view === "semana" ? "bg-field text-ink" : "text-muted hover:text-ink")}>
            Semana
          </Link>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Link href={prev} aria-label="Anterior" className="grid size-8 place-items-center rounded-lg border border-line bg-card text-muted hover:text-ink">
              <ChevronLeft className="size-4" />
            </Link>
            <h2 className="min-w-48 text-center text-[16px] font-semibold text-ink capitalize">{title}</h2>
            <Link href={next} aria-label="Siguiente" className="grid size-8 place-items-center rounded-lg border border-line bg-card text-muted hover:text-ink">
              <ChevronRight className="size-4" />
            </Link>
            <Link href={view === "mes" ? hrefFor({ mes: today.slice(0, 7) }) : hrefFor({ fecha: today })} className="ml-2 text-[12.5px] text-muted hover:text-ink">
              Hoy
            </Link>
          </div>
          {view === "mes" ? <MonthGrid month={month} occurrences={occurrences} today={today} hrefFor={(q) => hrefFor({ ...q, mes: undefined })} /> : <WeekView date={date} occurrences={occurrences} today={today} />}
        </div>

        <Card className="self-start p-5">
          <h2 className="text-[15px] font-semibold text-ink">Próximos eventos</h2>
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Sin eventos próximos" description="Los eventos de los próximos 60 días aparecen acá." className="px-0 py-10" />
          ) : (
            <ul className="mt-3 flex flex-col">
              {upcoming.map((o) => (
                <li key={o.key} className="border-b border-line/70 py-2.5 last:border-0">
                  <Link href={`/novedades/${o.event.id}`} className="block hover:opacity-80">
                    <span className="flex items-center gap-2">
                      <TypeChip type={o.event.eventType} />
                      <span className="text-[11.5px] text-muted">{whenLabel(o)}</span>
                    </span>
                    <span className="mt-1 block truncate text-[13.5px] font-medium text-ink">{o.event.title}</span>
                    <ScopeLabel scope={o.event.scope} client={o.event.organizationId ? orgNames.get(o.event.organizationId) : null} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
