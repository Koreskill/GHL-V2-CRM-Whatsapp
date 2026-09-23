import Link from "next/link";
import { CHANNEL_META } from "@/components/channel-icons";
import { Card, PageHeader } from "@/components/ui/primitives";
import { getReport } from "@/lib/crm/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reportes · Setter CRM" };

const RANGES = [7, 30, 90] as const;
const dayLabel = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });
const fmt = (n: number) => n.toLocaleString("es-AR");

function formatDuration(sec: number | null) {
  if (sec == null) return "—";
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = sec / 3600;
  return h < 48 ? `${h.toFixed(1).replace(".", ",")} h` : `${Math.round(h / 24)} d`;
}

export default async function ReportesPage({ searchParams }: PageProps<"/reportes">) {
  const params = await searchParams;
  const days = RANGES.find((r) => String(r) === params.days) ?? 30;
  const r = await getReport(days);

  const replies = r.agentReplies + r.humanReplies;
  const agentShare = replies ? Math.round((r.agentReplies / replies) * 100) : null;
  const max = Math.max(1, ...r.daily.map((d) => d.inbound));
  const maxChannel = Math.max(1, ...r.byChannel.map((c) => c.inbound));
  const labelEvery = Math.ceil(r.daily.length / 7);

  const tiles = [
    { label: "Conversaciones nuevas", value: fmt(r.newConversations) },
    { label: "Mensajes recibidos", value: fmt(r.inbound) },
    {
      label: "Respuestas enviadas",
      value: fmt(replies),
      hint: agentShare == null ? null : `${agentShare}% del agente IA`,
    },
    { label: "Primera respuesta (mediana)", value: formatDuration(r.medianFirstResponseSec) },
    { label: "Sin leer ahora", value: fmt(r.unread) },
    { label: "Envíos fallidos", value: fmt(r.failed), alert: r.failed > 0 },
  ];

  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle="Actividad de la bandeja y rendimiento del agente"
        actions={
          <div className="flex rounded-lg border border-line bg-card p-0.5">
            {RANGES.map((d) => (
              <Link
                key={d}
                href={`/reportes?days=${d}`}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                  d === days ? "bg-primary text-white" : "text-muted hover:text-ink",
                )}
              >
                {d} días
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-5 xl:grid-cols-6">
        {tiles.map((t) => (
          <Card key={t.label} className="p-5">
            <p className="text-[12.5px] font-medium text-muted">{t.label}</p>
            <p className={cn("mt-2 text-[26px] leading-none font-bold", t.alert ? "text-accent-red" : "text-ink")}>{t.value}</p>
            {t.hint && <p className="mt-2 text-[12px] text-muted">{t.hint}</p>}
          </Card>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-5">
        <Card className="col-span-2 p-6">
          <h2 className="text-[17px] font-semibold text-ink">Mensajes recibidos por día</h2>
          <p className="text-[13px] text-muted">Últimos {days} días, todos los canales</p>

          <div className="mt-6 flex gap-3">
            <div className="flex h-52 flex-col justify-between pb-6 text-right text-[11px] text-muted tabular-nums">
              <span>{fmt(max)}</span>
              <span>{fmt(Math.round(max / 2))}</span>
              <span>0</span>
            </div>
            <div className="relative flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-0 bottom-6 flex flex-col justify-between">
                <span className="border-t border-line/60" />
                <span className="border-t border-line/60" />
                <span className="border-t border-line" />
              </div>
              <div className="relative flex h-52 items-end gap-[2px] pb-6" aria-hidden>
                {r.daily.map((d, i) => {
                  const pct = (d.inbound / max) * 100;
                  return (
                    <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end">
                      <div
                        className="w-full rounded-t-[4px] bg-primary transition-opacity group-hover:opacity-80"
                        style={{ height: d.inbound ? `max(${pct}%, 2px)` : 0 }}
                      />
                      <div className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-10 hidden -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-[11.5px] whitespace-nowrap text-white shadow-card group-hover:block">
                        {dayLabel.format(new Date(d.day))} · <span className="font-semibold">{fmt(d.inbound)}</span> recibidos
                      </div>
                      {i % labelEvery === 0 && (
                        <span className="absolute -bottom-0 left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap text-muted">
                          {dayLabel.format(new Date(d.day))}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <table className="sr-only">
            <caption>Mensajes recibidos por día</caption>
            <thead>
              <tr>
                <th>Día</th>
                <th>Recibidos</th>
              </tr>
            </thead>
            <tbody>
              {r.daily.map((d) => (
                <tr key={d.day}>
                  <td>{d.day}</td>
                  <td>{d.inbound}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="p-6">
          <h2 className="text-[17px] font-semibold text-ink">Por canal</h2>
          <p className="text-[13px] text-muted">Mensajes recibidos en el período</p>
          <ul className="mt-6 flex flex-col gap-5">
            {r.byChannel.map((c) => {
              const { Icon, color, label } = CHANNEL_META[c.channel];
              return (
                <li key={c.channel}>
                  <div className="flex items-center gap-2 text-[13.5px]">
                    <Icon className={cn("size-4", color)} />
                    <span className="font-medium text-ink">{label}</span>
                    <span className="ml-auto font-semibold text-ink tabular-nums">{fmt(c.inbound)}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-field">
                    <div
                      className={cn("h-full rounded-full bg-current", color)}
                      style={{ width: c.inbound ? `max(${(c.inbound / maxChannel) * 100}%, 4px)` : 0 }}
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] text-muted">
                    {fmt(c.conversations)} {c.conversations === 1 ? "conversación" : "conversaciones"} en total
                  </p>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    </>
  );
}
