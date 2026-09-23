import { AlertCircle, CalendarClock, CalendarDays, ExternalLink, Video } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { calcomBookingUrl, listUpcomingBookings, type CalBooking } from "@/lib/calcom";
import { formatDayDivider, formatTime } from "@/lib/format";

export const metadata = { title: "Calendario · Setter CRM" };

export default async function CalendarioPage() {
  const url = calcomBookingUrl();
  const bookings = await listUpcomingBookings();

  if (!url && !bookings) {
    return (
      <>
        <PageHeader title="Calendario" subtitle="Agenda de visitas y reuniones con Cal.com" />
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Calendario sin conectar"
            description={
              <>
                Agrega <code className="rounded bg-field px-1.5 py-0.5 text-[12px] text-ink">CALCOM_URL</code> con el link de tu agenda y{" "}
                <code className="rounded bg-field px-1.5 py-0.5 text-[12px] text-ink">CALCOM_API_KEY</code> para ver las reservas, y reinicia la
                app.
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
        subtitle="Agenda de visitas y reuniones con Cal.com"
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

      <div className="grid grid-cols-5 gap-5">
        <Card className="col-span-2 self-start p-6">
          <div className="flex items-center gap-2">
            <h2 className="text-[17px] font-semibold text-ink">Próximas reservas</h2>
            {bookings?.ok && (
              <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">{bookings.data.length}</span>
            )}
          </div>
          <p className="text-[13px] text-muted">Lo que ya está agendado en Cal.com</p>
          <BookingList result={bookings} />
        </Card>

        <Card className="col-span-3 overflow-hidden">
          {embed ? (
            <iframe src={embed.toString()} title="Agenda de Cal.com" className="h-[720px] w-full border-0" loading="lazy" />
          ) : (
            <EmptyState
              icon={CalendarDays}
              title="Sin página de agenda"
              description="Agrega CALCOM_URL para mostrar acá la página donde los clientes eligen horario."
              className="py-24"
            />
          )}
        </Card>
      </div>
    </>
  );
}

function BookingList({ result }: { result: Awaited<ReturnType<typeof listUpcomingBookings>> }) {
  if (!result) {
    return <p className="mt-6 text-[13px] text-muted">Agrega CALCOM_API_KEY para ver las reservas.</p>;
  }
  if (!result.ok) {
    return (
      <p className="mt-6 flex items-start gap-2 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-ink">
        <AlertCircle className="mt-px size-4 shrink-0 text-accent-red" /> No se pudieron leer las reservas: {result.error}
      </p>
    );
  }
  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="No hay reservas próximas"
        description="Cuando alguien agende desde tu link de Cal.com, va a aparecer acá."
        className="px-0 py-12"
      />
    );
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
  const attendee = b.attendees[0];
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
          <a
            href={b.meetingUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir videollamada"
            className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted hover:bg-field hover:text-ink"
          >
            <Video className="size-4" strokeWidth={1.7} />
          </a>
        )}
      </div>
    </li>
  );
}
