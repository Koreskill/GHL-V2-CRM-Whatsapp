import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getRootDb } from "@/db";
import { calendarEventLinks, calendarSelections } from "@/db/schema";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { getSession } from "@/lib/auth";
import { googleCalendarConfigured, listCalendars, type GCalendar } from "@/lib/calendar/google/client";
import { accessTokenFor, getConnection } from "@/lib/calendar/google/connections";
import { disconnectAction, saveSelectionsAction } from "./actions";

export const metadata = { title: "Mi Google Calendar · Setter CRM" };

const ERRORS: Record<string, string> = {
  agencia: "Desde el modo agencia no se gestionan calendarios personales.",
  config: "Falta configurar Google Calendar en el servidor (GOOGLE_CALENDAR_CLIENT_ID/SECRET e INTEGRATIONS_ENCRYPTION_KEY).",
  limite: "Demasiados intentos. Espera unos minutos.",
  cancelado: "Cancelaste el permiso en Google.",
  state: "El enlace de conexión venció o ya se usó. Vuelve a intentarlo.",
  google: "Google no respondió bien. Vuelve a intentarlo.",
  permisos: "Google no concedió el permiso de disponibilidad (freebusy). Vuelve a conectar y deja esa casilla marcada.",
  sin_refresh: "Google no entregó una credencial duradera. Revoca el acceso de la app en tu cuenta de Google y vuelve a conectar.",
};

export default async function MiCalendarioPage({ searchParams }: PageProps<"/calendario/mi-calendario">) {
  const s = await getSession();
  if (!s) redirect("/login");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? "No se pudo completar.") : null;
  const conn = s.actingAsClient ? null : await getConnection(s.organizationId, s.user.id);

  let calendars: GCalendar[] = [];
  let selected = new Set<string>();
  let listError: string | null = null;
  let divergent = 0;
  if (conn) {
    const sel = await getRootDb().select({ id: calendarSelections.calendarId }).from(calendarSelections).where(eq(calendarSelections.connectionId, conn.id));
    selected = new Set(sel.map((x) => x.id));
    const links = await getRootDb().select({ st: calendarEventLinks.syncStatus }).from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, conn.id));
    divergent = links.filter((l) => l.st === "divergente" || l.st === "error").length;
    const token = await accessTokenFor(conn);
    if (token.ok) {
      const r = await listCalendars(token.data);
      if (r.ok) calendars = r.data;
      else listError = r.error;
    } else listError = token.error;
  }

  return (
    <>
      <PageHeader
        title="Mi Google Calendar"
        subtitle="Conexión personal: GHL lee solo cuándo estás ocupado (sin títulos ni invitados) y publica las visitas en un calendario aparte."
        actions={
          <Link href="/calendario/disponibilidad">
            <Button variant="secondary">Disponibilidad</Button>
          </Link>
        }
      />
      {error && <p className="mb-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
      {typeof sp.ok === "string" && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-accent-green">Listo.</p>}

      <Card className="mb-5 p-5">
        {!conn ? (
          <>
            <p className="text-[13.5px] text-ink">Todavía no conectaste tu Google Calendar.</p>
            <p className="mt-1 text-[12.5px] text-muted">Es independiente de cómo ingresas a Setter CRM: puedes entrar con email y contraseña y conectar un Calendar de otra cuenta.</p>
            <div className="mt-3">
              {googleCalendarConfigured() && !s.actingAsClient ? (
                <a href="/api/calendar/google/connect" className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover">
                  Conectar Google Calendar
                </a>
              ) : (
                <p className="text-[12.5px] text-muted">No disponible: {s.actingAsClient ? "modo agencia" : "falta configuración del servidor"}.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="text-[13.5px] text-ink">
              Conectado como <b>{conn.googleEmail ?? "cuenta de Google"}</b> · Ingresas a GHL como <b>{s.email}</b>
            </p>
            {conn.status !== "active" && (
              <p className="mt-2 text-[13px] text-accent-red">
                La conexión necesita reconectarse ({conn.lastError ?? "credencial vencida"}). Mientras tanto no se ofrecen tus horarios.{" "}
                <a href="/api/calendar/google/connect" className="underline">
                  Reconectar
                </a>
              </p>
            )}
            {divergent > 0 && <p className="mt-2 text-[13px] text-accent-amber">{divergent} visita(s) con diferencias o errores de sincronización con Google. Revísalas en Visitas.</p>}
            <form action={disconnectAction} className="mt-3">
              <Button type="submit" variant="secondary">
                Desconectar
              </Button>
            </form>
            <p className="mt-2 text-[12px] text-muted">Desconectar revoca el permiso y borra las credenciales. No cierra tu sesión ni borra visitas.</p>
          </>
        )}
      </Card>

      {conn && conn.status === "active" && (
        <Card className="p-5">
          <h2 className="text-[15px] font-semibold text-ink">Calendarios que bloquean mi disponibilidad</h2>
          {listError && <p className="mt-2 text-[13px] text-accent-red">No se pudo leer la lista: {listError}</p>}
          <form action={saveSelectionsAction} className="mt-3">
            <ul className="space-y-1.5">
              {calendars.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-2 text-[13px] text-ink">
                    <input type="checkbox" name="calendar" value={c.id} defaultChecked={selected.has(c.id)} />
                    {c.summary}
                    {c.primary ? " (principal)" : ""}
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-3">
              <Button type="submit">Guardar</Button>
            </div>
          </form>
        </Card>
      )}
    </>
  );
}
