import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/primitives";
import { getOrganization } from "@/lib/agency/queries";
import type { Session } from "@/lib/auth";
import { occurrencesIn, prioritizeNews, type Viewer } from "@/lib/news/logic";
import { listVisibleEvents, viewerFor, viewerForClient } from "@/lib/news/queries";
import { ScopeLabel, TypeChip, whenLabel } from "./parts";

const DAY = 86_400_000;
const REASON: Record<string, string> = { vencido: "Pendiente", hoy: "Hoy", proximo: "Próximo", reciente: "Reciente" };

async function items(viewer: Viewer, limit: number) {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * DAY);
  const to = new Date(now.getTime() + 30 * DAY);
  const events = await listVisibleEvents(viewer, from, to);
  return prioritizeNews(occurrencesIn(events, from, to), now, limit);
}

/**
 * Resumen operativo para el dashboard: qué tiene que saber o hacer el equipo ahora. No es el
 * calendario completo: 3 a 5 ítems ordenados por urgencia (pendientes, hoy, próximos, anuncios).
 */
export async function NewsSummary({ session }: { session: Session }) {
  const list = await items(await viewerFor(session), 5).catch(() => null);
  return (
    <Card className="mt-6 p-6">
      <div className="flex items-baseline gap-3">
        <div>
          <h2 className="text-[17px] font-semibold text-ink">Novedades</h2>
          <p className="text-[13px] text-muted">Lo que el equipo necesita saber o hacer ahora</p>
        </div>
        <Link href="/novedades" className="ml-auto text-[12.5px] font-medium text-primary hover:underline">
          Ver todas
        </Link>
      </div>
      {list === null ? (
        <p className="mt-4 text-[13px] text-muted">No se pudieron cargar las novedades.</p>
      ) : list.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Sin novedades" description="Cuando haya eventos, recordatorios o anuncios aparecen acá." className="py-8" />
      ) : (
        <ul className="mt-3 divide-y divide-line/70">
          {list.map(({ occurrence: o, reason }) => (
            <li key={o.key}>
              <Link href={`/novedades/${o.event.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                <span className={`w-[68px] shrink-0 text-[11px] font-semibold uppercase ${reason === "vencido" ? "text-accent-red" : reason === "hoy" ? "text-accent-amber" : "text-muted"}`}>{REASON[reason]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{o.event.title}</span>
                  <span className="flex items-center gap-2 text-[11.5px] text-muted">
                    {whenLabel(o)} · <ScopeLabel scope={o.event.scope} />
                  </span>
                </span>
                <TypeChip type={o.event.eventType} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** El calendario de UN cliente (la misma tabla, filtrada), para su ficha en el plano de agencia. */
export async function ClientNews({ clientOrgId }: { clientOrgId: string }) {
  const [list, org] = await Promise.all([viewerForClient(clientOrgId).then((v) => items(v, 6)).catch(() => null), getOrganization(clientOrgId)]);
  return (
    <Card className="p-6">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[17px] font-semibold text-ink">Novedades de {org?.name ?? "este cliente"}</h2>
        <Link href={`/novedades?ambito=cliente&cliente=${clientOrgId}`} className="ml-auto text-[12.5px] font-medium text-primary hover:underline">
          Ver calendario
        </Link>
      </div>
      {list === null ? (
        <p className="mt-3 text-[13px] text-muted">No se pudieron cargar las novedades.</p>
      ) : list.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Sin eventos próximos para este cliente.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line/70">
          {list.map(({ occurrence: o }) => (
            <li key={o.key}>
              <Link href={`/novedades/${o.event.id}`} className="flex items-center gap-3 py-2 hover:opacity-80">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{o.event.title}</span>
                  <span className="flex items-center gap-2 text-[11.5px] text-muted">
                    {whenLabel(o)} · <ScopeLabel scope={o.event.scope} />
                  </span>
                </span>
                <TypeChip type={o.event.eventType} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
