import Link from "next/link";
import { AlertCircle, CalendarClock, CalendarDays, ExternalLink, RefreshCw, Video } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireOrgId } from "@/lib/auth";
import { loadRemoteBookings, listUpcomingLocalVisits, resolveCalendar, type LocalVisit, type RemoteList } from "@/lib/calendar/queries";
import type { CalBooking } from "@/lib/calendar/calcom-api";
import { formatDayDivider, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { retryVisitSync } from "./actions";

export const metadata = { title: "Calendario · Setter CRM" };

const SYNC_LABEL: Record<string, { text: string; tone: string }> = {
  sincronizada: { text: "En Cal.com", tone: "bg-accent-green/12 text-accent-green" },
  pendiente: { text: "Pendiente de sincronizar", tone: "bg-accent-amber/12 text-accent-amber" },
  error: { text: "Error de sincronización", tone: "bg-accent-red/10 text-accent-red" },
  cancelada: { text: "Cancelada en Cal.com", tone: "bg-field text-muted" },
};

export default async function CalendarioPage({ searchParams }: PageProps<"/calendario">) {
  // Todo sale de la inmobiliaria activa: la integración, las reservas y las visitas.
  const orgId = await requireOrgId();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;

  const source = await resolveCalendar(orgId);
  const [bookings, visits] = await Promise.all([loadRemoteBookings(source), listUpcomingLocalVisits(orgId)]);
  const url = source.kind === "none" ? null : source.bookingUrl;

  if (source.kind === "none" && visits.length === 0) {
    return (
      <>
        <PageHeader title="Calendario" subtitle="Agenda de visitas de tu inmobiliaria" />
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Calendario sin conectar"
            description={
              <>
                Conectá la cuenta de Cal.com de tu inmobiliaria en{" "}
                <Link href="/configuracion?tab=calendario" className="font-medium text-ink underline">
                  Configuración → Calendario
                </Link>{" "}
                para reservar las visitas y ver tu agenda.
              </>
            }
            className="py-24"
          />
        </Card>
      </>
    );
  }

  const embed = url ? new URL(url) : null;
  if (embed) {
    embed.searchParams.set("embed", "true");
    embed.searchParams.set("theme", "light");
  }

  return (
    <>
      <PageHeader
        title="Calendario"
        subtitle="Visitas agendadas y reservas de tu Cal.com"
        actions={
          url && (
            <a
              href={url.toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
            >
              <ExternalLink className="size-4" strokeWidth={1.7} /> Abrir en Cal.com
            </a>
          )
        }
      />
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card className="p-6">
            <h2 className="text-[17px] font-semibold text-ink">Visitas agendadas</h2>
            <p className="text-[13px] text-muted">Las del CRM, con el estado de su reserva en Cal.com</p>
            <VisitList visits={visits} connected={source.kind === "integration"} />
          </Card>

          <Card className="self-start p-6">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold text-ink">Reservas en Cal.com</h2>
              {bookings?.ok && <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">{bookings.data.length}</span>}
            </div>
            <p className="text-[13px] text-muted">Lo que ya está agendado en tu cuenta</p>
            <BookingList result={bookings} />
          </Card>
        </div>

        <Card className="overflow-hidden lg:col-span-3">
          {embed ? (
            <iframe src={embed.toString()} title="Agenda de Cal.com" className="h-[720px] w-full border-0" loading="lazy" />
          ) : (
            <EmptyState icon={CalendarDays} title="Sin página de agenda" description="Agregá el enlace de tu agenda en Configuración → Calendario." className="py-24" />
          )}
        </Card>
      </div>
    </>
  );
}

function VisitList({ visits, connected }: { visits: LocalVisit[]; connected: boolean }) {
  if (visits.length === 0) {
    return <EmptyState icon={CalendarClock} title="No hay visitas agendadas" description="Cuando agendes una visita, aparece acá." className="px-0 py-10" />;
  }
  return (
    <ol className="mt-4 flex flex-col">
      {visits.map((v, i) => {
        const sync = v.sync ? SYNC_LABEL[v.sync.status] : null;
        return (
          <li key={v.id}>
            {(i === 0 || formatDayDivider(visits[i - 1].scheduledAt) !== formatDayDivider(v.scheduledAt)) && (
              <p className="pt-4 pb-2 text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">{formatDayDivider(v.scheduledAt)}</p>
            )}
            <div className="flex gap-3 border-b border-line/70 py-3 last:border-0">
              <div className="w-14 shrink-0 text-[13px] font-semibold text-ink tabular-nums">{formatTime(v.scheduledAt)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium text-ink">{v.contactName ?? "Contacto"}</p>
                <p className="truncate text-[12px] text-muted">{v.propertyTitle ?? "Propiedad"}</p>
                {connected && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", sync?.tone ?? "bg-field text-muted")}>{sync?.text ?? "Sin reserva en Cal.com"}</span>
                    {(!v.sync || v.sync.status === "error" || v.sync.status === "pendiente") && (
                      <form action={retryVisitSync}>
                        <input type="hidden" name="visitId" value={v.id} />
                        <button type="submit" className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-ink">
                          <RefreshCw className="size-3" strokeWidth={1.8} /> Reintentar
                        </button>
                      </form>
                    )}
                  </div>
                )}
                {v.sync?.status === "error" && v.sync.error && <p className="mt-1 text-[11.5px] text-accent-red">{v.sync.error}</p>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function BookingList({ result }: { result: RemoteList }) {
  if (!result) return <p className="mt-6 text-[13px] text-muted">Conectá Cal.com para ver las reservas.</p>;
  if (!result.ok) {
    return (
      <p className="mt-6 flex items-start gap-2 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-ink">
        <AlertCircle className="mt-px size-4 shrink-0 text-accent-red" /> No se pudieron leer las reservas: {result.error}
      </p>
    );
  }
  if (result.data.length === 0) {
    return <EmptyState icon={CalendarClock} title="No hay reservas próximas" description="Cuando alguien agende desde tu link de Cal.com, va a aparecer acá." className="px-0 py-12" />;
  }
  return (
    <ol className="mt-4 flex flex-col">
      {result.data.map((b, i) => (
        <BookingItem key={b.uid} booking={b} showDay={i === 0 || formatDayDivider(result.data[i - 1].start) !== formatDayDivider(b.start)} />
      ))}
    </ol>
  );
}

function BookingItem({ booking: b, showDay }: { booking: CalBooking; showDay: boolean }) {
  const attendee = b.attendees?.[0];
  return (
    <li>
      {showDay && <p className="pt-4 pb-2 text-[11px] font-semibold tracking-[0.1em] text-muted uppercase">{formatDayDivider(b.start)}</p>}
      <div className="flex gap-3 border-b border-line/70 py-3 last:border-0">
        <div className="w-14 shrink-0 text-[13px] font-semibold text-ink tabular-nums">
          {formatTime(b.start)}
          <span className="block text-[11.5px] font-normal text-muted">{b.duration} min</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-ink">{attendee?.name ?? b.title}</p>
          {attendee?.email && <p className="truncate text-[12px] text-muted">{attendee.email}</p>}
          {b.status !== "accepted" && <p className="mt-0.5 text-[12px] text-accent-amber">Pendiente de confirmar</p>}
        </div>
        {b.meetingUrl?.startsWith("https://") && (
          <a href={b.meetingUrl} target="_blank" rel="noopener noreferrer" title="Abrir videollamada" className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted hover:bg-field hover:text-ink">
            <Video className="size-4" strokeWidth={1.7} />
          </a>
        )}
      </div>
    </li>
  );
}
