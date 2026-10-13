import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/db";
import { availabilityBlocks, availabilityRules } from "@/db/schema";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { getSession } from "@/lib/auth";
import { getCalendarSettings, slotsFor } from "@/lib/calendar/book";
import { APP_TIME_ZONE } from "@/lib/tz";
import { addBlockAction, addRuleAction, deleteBlockAction, deleteRuleAction, saveSettingsAction } from "./actions";

export const metadata = { title: "Disponibilidad · Setter CRM" };

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const input = "h-9 rounded-lg border border-line bg-field px-2 text-[13px] text-ink";
const fmt = (d: Date) => new Intl.DateTimeFormat("es-AR", { timeZone: APP_TIME_ZONE, weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

export default async function DisponibilidadPage({ searchParams }: PageProps<"/calendario/disponibilidad">) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const db = getDb();
  const [settings, rules, blocks] = await Promise.all([
    getCalendarSettings(s.organizationId),
    db.select().from(availabilityRules).where(and(eq(availabilityRules.organizationId, s.organizationId), eq(availabilityRules.userId, s.user.id))).orderBy(availabilityRules.weekday, availabilityRules.startMin),
    db.select().from(availabilityBlocks).where(and(eq(availabilityBlocks.organizationId, s.organizationId), gt(availabilityBlocks.endsAt, new Date()))).orderBy(availabilityBlocks.startsAt),
  ]);
  const preview = settings?.enabled ? await slotsFor(s.organizationId, s.user.id) : null;
  const isAdmin = s.role === "admin";

  return (
    <>
      <PageHeader
        title="Disponibilidad"
        subtitle="Cuándo se pueden agendar visitas. Sin configurar, el agente no ofrece horarios."
        actions={
          <div className="flex gap-2">
            <Link href="/calendario/mi-calendario">
              <Button variant="secondary">Mi Google Calendar</Button>
            </Link>
            <Link href="/calendario">
              <Button variant="secondary">Volver</Button>
            </Link>
          </div>
        }
      />
      {error && <p className="mb-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
      {ok && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-accent-green">Guardado.</p>}

      {isAdmin && (
        <Card className="mb-5 p-5">
          <h2 className="text-[15px] font-semibold text-ink">Política de la inmobiliaria</h2>
          <p className="mt-1 text-[12.5px] text-muted">Estas cifras las define tu inmobiliaria: no hay valores por defecto.</p>
          <form action={saveSettingsAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[13px] text-ink">
              Duración de la visita (min)
              <input name="durationMin" type="number" defaultValue={settings?.durationMin ?? ""} className={`${input} mt-1 w-full`} />
            </label>
            <label className="text-[13px] text-ink">
              Traslado entre visitas (min)
              <input name="bufferMin" type="number" defaultValue={settings?.bufferMin ?? ""} className={`${input} mt-1 w-full`} />
            </label>
            <label className="text-[13px] text-ink">
              Anticipación mínima (min)
              <input name="minNoticeMin" type="number" defaultValue={settings?.minNoticeMin ?? ""} className={`${input} mt-1 w-full`} />
            </label>
            <label className="text-[13px] text-ink">
              Horizonte de reservas (días)
              <input name="horizonDays" type="number" defaultValue={settings?.horizonDays ?? ""} className={`${input} mt-1 w-full`} />
            </label>
            <label className="text-[13px] text-ink">
              Calendario interno
              <select name="enabled" defaultValue={settings?.enabled ? "1" : "0"} className={`${input} mt-1 w-full`}>
                <option value="0">Desactivado</option>
                <option value="1">Activado</option>
              </select>
            </label>
            <label className="text-[13px] text-ink">
              Quién crea las reservas nuevas
              <select name="provider" defaultValue={settings?.provider ?? "calcom"} className={`${input} mt-1 w-full`}>
                <option value="calcom">Cal.com (actual)</option>
                <option value="internal">Calendario interno</option>
              </select>
            </label>
            <div className="sm:col-span-2">
              <Button type="submit">Guardar política</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="mb-5 p-5">
        <h2 className="text-[15px] font-semibold text-ink">Mis horarios laborales</h2>
        <ul className="mt-3 divide-y divide-line">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-[13px] text-ink">
              <span>
                {DAYS[r.weekday]} · {hhmm(r.startMin)} a {hhmm(r.endMin)}
              </span>
              <form action={deleteRuleAction}>
                <input type="hidden" name="id" value={r.id} />
                <Button type="submit" variant="secondary">
                  Quitar
                </Button>
              </form>
            </li>
          ))}
          {rules.length === 0 && <li className="py-2 text-[13px] text-muted">Todavía no cargaste franjas.</li>}
        </ul>
        <form action={addRuleAction} className="mt-3 flex flex-wrap items-center gap-2">
          <select name="weekday" defaultValue="1" className={input}>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <input name="start" type="time" required defaultValue="09:00" className={input} />
          <input name="end" type="time" required defaultValue="13:00" className={input} />
          <Button type="submit">Agregar franja</Button>
        </form>
      </Card>

      <Card className="mb-5 p-5">
        <h2 className="text-[15px] font-semibold text-ink">Bloqueos (vacaciones, feriados, pausas)</h2>
        <ul className="mt-3 divide-y divide-line">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2 text-[13px] text-ink">
              <span>
                {fmt(b.startsAt)} → {fmt(b.endsAt)} · {b.userId ? "personal" : "toda la inmobiliaria"}
                {b.reason ? ` · ${b.reason}` : ""}
              </span>
              {(isAdmin || b.userId === s.user.id) && (
                <form action={deleteBlockAction}>
                  <input type="hidden" name="id" value={b.id} />
                  <Button type="submit" variant="secondary">
                    Quitar
                  </Button>
                </form>
              )}
            </li>
          ))}
          {blocks.length === 0 && <li className="py-2 text-[13px] text-muted">Sin bloqueos próximos.</li>}
        </ul>
        <form action={addBlockAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input name="startsAt" type="datetime-local" required className={input} />
          <input name="endsAt" type="datetime-local" required className={input} />
          <input name="reason" placeholder="Motivo (opcional)" className={`${input} w-48`} />
          <select name="scope" defaultValue="me" className={input}>
            <option value="me">Solo yo</option>
            {isAdmin && <option value="org">Toda la inmobiliaria</option>}
          </select>
          <Button type="submit">Bloquear</Button>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">Próximos horarios que se ofrecerían</h2>
        {!preview ? (
          <p className="mt-2 text-[13px] text-muted">Activa el calendario interno para ver una vista previa.</p>
        ) : preview.status === "no_configurado" ? (
          <p className="mt-2 text-[13px] text-muted">Faltan cifras de la política.</p>
        ) : preview.status === "no_verificable" ? (
          <p className="mt-2 text-[13px] text-accent-red">No se pudo leer tu Google Calendar, así que no se ofrece ningún horario: {preview.reason}</p>
        ) : preview.slots.length === 0 ? (
          <p className="mt-2 text-[13px] text-muted">Sin horarios libres en el horizonte configurado.</p>
        ) : (
          <p className="mt-2 text-[13px] text-ink">{preview.slots.slice(0, 8).map((x) => fmt(x.start)).join(" · ")}</p>
        )}
      </Card>
    </>
  );
}
