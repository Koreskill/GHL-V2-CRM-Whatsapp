import { disconnectCalendarIntegration, saveCalendarIntegration, testCalendarIntegration } from "@/app/(app)/calendario/actions";
import { Button } from "@/components/ui/primitives";
import type { Integration } from "@/lib/calendar/integration";

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";

export function CalendarForm({
  integration,
  webhookUrl,
  webhookSecret,
  encryptionOk,
}: {
  integration: Integration | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  encryptionOk: boolean;
}) {
  return (
    <div className="grid max-w-2xl gap-6">
      {!encryptionOk && (
        <p className="rounded-lg bg-accent-amber/10 px-3 py-2 text-[13px] text-ink">
          Falta <code className="rounded bg-field px-1 text-[12px]">INTEGRATIONS_ENCRYPTION_KEY</code> en el servidor (32 bytes en base64). Sin ella no se puede guardar la clave de Cal.com.
        </p>
      )}

      <form action={saveCalendarIntegration} className="grid gap-4">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Clave de API de Cal.com {integration && "(dejala vacía para conservar la guardada)"}
          <input name="apiKey" type="password" autoComplete="off" placeholder={integration ? "••••••••••••" : "cal_live_…"} className={field} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            Id del tipo de evento de visitas
            <input name="eventTypeId" required inputMode="numeric" defaultValue={integration?.eventTypeId ?? ""} className={field} />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] text-muted">
            Zona horaria
            <input name="timeZone" defaultValue={integration?.timeZone ?? "America/Argentina/Buenos_Aires"} className={field} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Enlace público de la agenda (https)
          <input name="bookingUrl" defaultValue={integration?.bookingUrl ?? ""} placeholder="https://cal.com/tu-inmobiliaria/visita" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Email de respaldo (para contactos sin email; Cal.com lo exige)
          <input name="fallbackEmail" type="email" defaultValue={integration?.fallbackEmail ?? ""} className={field} />
        </label>
        <div>
          <Button type="submit" disabled={!encryptionOk}>
            {integration ? "Guardar cambios" : "Conectar Cal.com"}
          </Button>
        </div>
      </form>

      {integration && (
        <>
          <div className="rounded-xl border border-line p-4">
            <p className="text-[13.5px] font-semibold text-ink">
              Estado: {integration.status === "conectada" ? "conectada" : "con error"}
              {integration.lastCheckedAt && <span className="ml-2 text-[12px] font-normal text-muted">revisada {integration.lastCheckedAt.toLocaleString("es-AR")}</span>}
            </p>
            {integration.lastError && <p className="mt-1 text-[12.5px] text-accent-red">{integration.lastError}</p>}
            <form action={testCalendarIntegration} className="mt-3">
              <Button type="submit" variant="secondary">
                Probar conexión
              </Button>
            </form>
          </div>

          <div className="rounded-xl border border-line p-4 text-[13px] text-ink">
            <p className="font-semibold">Webhook para cambios hechos fuera del CRM</p>
            <p className="mt-1 text-[12.5px] text-muted">
              En Cal.com → Webhooks, creá uno con los eventos <em>Booking created, rescheduled y cancelled</em> y pegá esta URL y este secreto. Así, si el cliente reprograma o cancela desde Cal.com, la visita se actualiza acá.
            </p>
            <p className="mt-2 text-[12px] text-muted">URL</p>
            <code className="block overflow-x-auto rounded bg-field px-2 py-1 text-[12px]">{webhookUrl}</code>
            <p className="mt-2 text-[12px] text-muted">Secreto</p>
            <code className="block overflow-x-auto rounded bg-field px-2 py-1 text-[12px]">{webhookSecret ?? "No disponible (revisar la clave de cifrado)"}</code>
          </div>

          <form action={disconnectCalendarIntegration}>
            <Button type="submit" variant="secondary">
              Desconectar
            </Button>
            <span className="ml-3 text-[12px] text-muted">Las visitas y sus vínculos se conservan; deja de sincronizar.</span>
          </form>
        </>
      )}
    </div>
  );
}
