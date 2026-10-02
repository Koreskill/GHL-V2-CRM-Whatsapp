import { Button } from "@/components/ui/primitives";
import { EVENT_TYPES, EVENT_TYPE_LABEL, SCOPES, SCOPE_LABEL, type NewsEvent } from "@/lib/news/logic";
import { APP_TIME_ZONE } from "@/lib/tz";

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";

// "yyyy-mm-ddThh:mm" en hora de Argentina, el formato que espera el input datetime-local.
function local(d: Date | null) {
  if (!d) return "";
  const p = new Intl.DateTimeFormat("sv-SE", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  return p.replace(" ", "T");
}

export function EventForm({
  action,
  event,
  networks,
  clients,
  defaults,
  submitLabel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  event?: NewsEvent;
  networks: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  defaults?: { scope?: string; organizationId?: string };
  submitLabel: string;
}) {
  const scope = event?.scope ?? defaults?.scope ?? "network";
  return (
    <form action={action} className="grid max-w-2xl gap-4">
      {event && <input type="hidden" name="id" value={event.id} />}
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        Título
        <input name="title" required maxLength={160} defaultValue={event?.title} className={field} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Tipo
          <select name="eventType" defaultValue={event?.eventType ?? "announcement"} className={field}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Quién lo ve
          <select name="scope" defaultValue={scope} className={field}>
            {SCOPES.map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 rounded-xl border border-line p-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Red (si es para la red)
          <select name="networkId" defaultValue={event?.networkId ?? ""} className={field}>
            <option value="">—</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Cliente (si es de un cliente)
          <select name="organizationId" defaultValue={event?.organizationId ?? defaults?.organizationId ?? ""} className={field}>
            <option value="">—</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[11.5px] text-muted sm:col-span-2">
          <strong>Red</strong>: la ven los miembros de la red. <strong>Equipo interno</strong>: solo la agencia. <strong>Cliente</strong>: solo la agencia, dentro del espacio de ese cliente. Se usa el destino que corresponde al alcance elegido.
        </p>
      </div>

      <label className="flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" name="allDay" defaultChecked={event?.allDay} className="size-4 accent-[var(--color-primary)]" /> Todo el día
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Inicio
          <input type="datetime-local" name="startAt" required defaultValue={local(event?.startAt ?? null)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Fin (opcional)
          <input type="datetime-local" name="endAt" defaultValue={local(event?.endAt ?? null)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Recordatorio (opcional)
          <input type="datetime-local" name="reminderAt" defaultValue={local(event?.reminderAt ?? null)} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            Se repite
            <select name="recurrence" defaultValue={event?.recurrence ?? "none"} className={field}>
              <option value="none">No</option>
              <option value="daily">Cada día</option>
              <option value="weekly">Cada semana</option>
              <option value="monthly">Cada mes</option>
              <option value="yearly">Cada año</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            Hasta
            <input type="date" name="recurrenceUntil" defaultValue={event?.recurrenceUntil ? local(event.recurrenceUntil).slice(0, 10) : ""} className={field} />
          </label>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Lugar
          <input name="location" maxLength={200} defaultValue={event?.location ?? ""} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Enlace de la reunión (https)
          <input name="meetingUrl" defaultValue={event?.meetingUrl ?? ""} inputMode="url" className={field} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        Descripción
        <textarea name="description" rows={4} maxLength={4000} defaultValue={event?.description ?? ""} className="rounded-lg border border-line bg-field px-3 py-2 text-[13.5px] text-ink focus:border-primary focus:outline-none" />
      </label>
      <div>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}
