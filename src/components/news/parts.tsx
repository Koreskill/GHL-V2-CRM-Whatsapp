import Link from "next/link";
import { EVENT_TYPE_LABEL, SCOPE_LABEL, addDays, dayKey, monthGrid, weekStart, type EventType, type Occurrence } from "@/lib/news/logic";
import { cn } from "@/lib/utils";

// Un color por tipo de evento, con los tokens de acento del sistema (solo estados, etapas y tipos).
export const TYPE_TONE: Record<EventType, string> = {
  activity: "bg-accent-blue/12 text-accent-blue",
  reminder: "bg-accent-amber/12 text-accent-amber",
  meeting: "bg-accent-purple/12 text-accent-purple",
  training: "bg-accent-cyan/12 text-accent-cyan",
  network_event: "bg-accent-green/12 text-accent-green",
  announcement: "bg-accent-orange/12 text-accent-orange",
  deadline: "bg-accent-red/10 text-accent-red",
  custom: "bg-accent-slate/12 text-accent-slate",
};

const time = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit" });
const dayLabel = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "short", day: "numeric", month: "short" });

export const whenLabel = (o: Occurrence) => (o.event.allDay ? `${dayLabel.format(o.startAt)} · todo el día` : `${dayLabel.format(o.startAt)} · ${time.format(o.startAt)}`);

export function TypeChip({ type }: { type: EventType }) {
  return <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-medium", TYPE_TONE[type])}>{EVENT_TYPE_LABEL[type]}</span>;
}

export function ScopeLabel({ scope, client }: { scope: keyof typeof SCOPE_LABEL; client?: string | null }) {
  return <span className="text-[11.5px] text-muted">{scope === "client" && client ? `Cliente · ${client}` : SCOPE_LABEL[scope]}</span>;
}

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function EventPill({ o }: { o: Occurrence }) {
  return (
    <Link href={`/novedades/${o.event.id}`} title={o.event.title} className={cn("block truncate rounded px-1.5 py-0.5 text-[11.5px] font-medium hover:opacity-80", TYPE_TONE[o.event.eventType])}>
      {!o.event.allDay && <span className="mr-1 tabular-nums opacity-70">{time.format(o.startAt)}</span>}
      {o.event.title}
    </Link>
  );
}

/** Calendario mensual. Cada día muestra hasta 3 eventos y "+N" para el resto, que lleva a la vista de esa semana. */
export function MonthGrid({ month, occurrences, today, hrefFor }: { month: string; occurrences: Occurrence[]; today: string; hrefFor: (q: Record<string, string>) => string }) {
  const days = monthGrid(month);
  const byDay = new Map<string, Occurrence[]>();
  for (const o of occurrences) {
    const k = dayKey(o.startAt);
    byDay.set(k, [...(byDay.get(k) ?? []), o]);
  }
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <div className="grid grid-cols-7 border-b border-line text-center text-[11px] font-semibold tracking-wide text-muted uppercase">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          return (
            <div key={d} className={cn("min-h-[104px] border-r border-b border-line/70 p-1.5 [&:nth-child(7n)]:border-r-0", !inMonth && "bg-field/50")}>
              <Link href={hrefFor({ vista: "semana", fecha: d })} className={cn("mb-1 inline-grid size-6 place-items-center rounded-full text-[12px]", d === today ? "bg-primary font-semibold text-white" : inMonth ? "text-ink hover:bg-field" : "text-muted")}>
                {Number(d.slice(8))}
              </Link>
              <div className="flex flex-col gap-0.5">
                {list.slice(0, 3).map((o) => (
                  <EventPill key={o.key} o={o} />
                ))}
                {list.length > 3 && (
                  <Link href={hrefFor({ vista: "semana", fecha: d })} className="px-1 text-[11px] text-muted hover:text-ink">
                    +{list.length - 3} más
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const longDay = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long", day: "numeric", month: "long" });

/** Semana: una fila por día con todos sus eventos. */
export function WeekView({ date, occurrences, today }: { date: string; occurrences: Occurrence[]; today: string }) {
  const start = weekStart(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      {days.map((d) => {
        const list = occurrences.filter((o) => dayKey(o.startAt) === d);
        return (
          <div key={d} className="flex gap-4 border-b border-line/70 px-5 py-3 last:border-0">
            <p className={cn("w-32 shrink-0 text-[13px] capitalize", d === today ? "font-semibold text-primary" : "text-muted")}>{longDay.format(new Date(`${d}T15:00:00Z`))}</p>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {list.length === 0 ? <span className="text-[12.5px] text-muted/70">Sin eventos</span> : list.map((o) => <EventPill key={o.key} o={o} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
