import { Download, Pause, Play, ShieldAlert } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { deleteOrgAction, reactivateOrgAction, suspendOrgAction } from "@/app/(app)/agencia/actions";
import { normalizeOrgStatus, ORG_STATUS_LABEL } from "@/lib/agency/lifecycle";
import type { clientHealth } from "@/lib/agency/health";
import { cn } from "@/lib/utils";

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";

type Health = Awaited<ReturnType<typeof clientHealth>>;

// Estado de integraciones y ciclo de vida de un cliente. Solo se usa en el plano de agencia (el servidor
// valida requireAgencyAdmin en la página y en cada acción).
export function LifecyclePanel({ org, health, isHome }: { org: { id: string; name: string; status: string; statusReason: string | null }; health: Health; isHome: boolean }) {
  const status = normalizeOrgStatus(org.status);
  const usd = (n: number | null) => (n === null ? "sin dato" : `USD ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`);
  return (
    <div className="mb-6 grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <p className="text-[15px] font-semibold text-ink">Integraciones y operación</p>
        <ul className="mt-3 grid gap-2 text-[13px]">
          {health.accounts.length === 0 ? (
            <Item tone="bad">Sin cuentas de mensajería asignadas</Item>
          ) : (
            health.accounts.map((a, i) => (
              <Item key={i} tone={a.status === "connected" ? "ok" : "bad"}>
                {a.channel} · {a.name ?? a.handle ?? "cuenta"} · {a.status === "connected" ? "conectada" : "desconectada"}
              </Item>
            ))
          )}
          <Item tone={!health.sheet ? "warn" : health.sheet.last_status === "error" ? "bad" : "ok"}>
            Hoja de propiedades: {!health.sheet ? "sin configurar" : health.sheet.last_status === "error" ? `error (${health.sheet.last_error ?? "sin detalle"})` : health.sheet.last_run_at ? `sincronizada ${new Date(health.sheet.last_run_at).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}` : "nunca sincronizada"}
          </Item>
          <Item tone={health.jobs.dead > 0 || (health.jobs.oldest_queued_min ?? 0) > 10 ? "bad" : health.jobs.failed > 0 ? "warn" : "ok"}>
            Cola: {health.jobs.queued} en curso · {health.jobs.failed} reintentando · {health.jobs.dead} agotados (7 d)
            {health.jobs.oldest_queued_min ? ` · el más viejo espera ${health.jobs.oldest_queued_min} min` : ""}
          </Item>
          <Item tone={health.ai.errors > 0 ? "warn" : "ok"}>
            IA este mes: {health.ai.calls} llamadas · costo medido {usd(health.ai.measuredUsd)}
            {health.ai.without_cost > 0 ? ` · ${health.ai.without_cost} sin costo informado (no sumadas)` : ""} · {health.ai.errors} con error
          </Item>
          <Item tone="ok">
            Automático: {health.automation.campaigns} campañas abiertas · {health.automation.sequences} secuencias encendidas · {health.automation.enrollments} seguimientos en curso
          </Item>
        </ul>
      </Card>

      <Card className={cn("p-5", status !== "activa" && "border-accent-amber/40")}>
        <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
          <ShieldAlert className="size-4 text-muted" strokeWidth={1.7} /> Estado del cliente: {ORG_STATUS_LABEL[status]}
        </p>
        {org.statusReason && <p className="mt-1 text-[12.5px] text-muted">Motivo: {org.statusReason}</p>}
        <a
          href={`/api/agencia/${org.id}/export`}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
        >
          <Download className="size-4" strokeWidth={1.7} /> Exportar sus datos (JSON)
        </a>

        {isHome ? (
          <p className="mt-3 text-[12.5px] text-muted">Es la inmobiliaria de la agencia: no se suspende ni se elimina desde acá.</p>
        ) : status === "activa" ? (
          <form action={suspendOrgAction} className="mt-4 grid gap-2">
            <input type="hidden" name="organizationId" value={org.id} />
            <p className="text-[12.5px] text-muted">
              Suspender corta ya el acceso de sus usuarios, el bot, las campañas (quedan pausadas) y los seguimientos (se posponen), y retira sus propiedades de la red. Los mensajes entrantes se siguen guardando. Nada se borra.
            </p>
            <input name="reason" maxLength={200} placeholder="Motivo (queda registrado)" className={field} />
            <div>
              <Button type="submit" variant="secondary">
                <Pause className="size-4" strokeWidth={1.8} /> Suspender
              </Button>
            </div>
          </form>
        ) : status === "suspendida" ? (
          <>
            <form action={reactivateOrgAction} className="mt-4">
              <input type="hidden" name="organizationId" value={org.id} />
              <p className="mb-2 text-[12.5px] text-muted">Reactivar devuelve el acceso y lo automático. Las campañas quedan pausadas hasta que un admin las reanude, y sus publicaciones en la red no vuelven solas.</p>
              <Button type="submit">
                <Play className="size-4" strokeWidth={1.8} /> Reactivar
              </Button>
            </form>
            <form action={deleteOrgAction} className="mt-5 grid gap-2 border-t border-line pt-4">
              <input type="hidden" name="organizationId" value={org.id} />
              <p className="text-[12.5px] font-medium text-accent-red">Eliminar (irreversible)</p>
              <p className="text-[12.5px] text-muted">
                Anonimiza: borra nombres, teléfonos, emails, textos de mensajes, notas y credenciales; desasigna sus cuentas de mensajería y revoca sus usuarios. Se conservan solo números agregados. No toca redes ni datos de otras inmobiliarias.
              </p>
              <label className="flex items-center gap-2 text-[12.5px] text-ink">
                <input type="checkbox" name="exported" className="size-4" /> Ya se entregó la exportación (o no corresponde)
              </label>
              <input name="typedName" required placeholder={`Escribí «${org.name}» para confirmar`} className={field} />
              <div>
                <Button type="submit" variant="secondary">Eliminar y anonimizar</Button>
              </div>
            </form>
          </>
        ) : (
          <p className="mt-3 text-[12.5px] text-muted">Eliminada: sus datos personales fueron anonimizados. Los mensajes que lleguen a sus cuentas se descartan.</p>
        )}
      </Card>
    </div>
  );
}

function Item({ tone, children }: { tone: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", tone === "ok" ? "bg-accent-green" : tone === "warn" ? "bg-accent-amber" : "bg-accent-red")} />
      <span className="text-ink">{children}</span>
    </li>
  );
}
