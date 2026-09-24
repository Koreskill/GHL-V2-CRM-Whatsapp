"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, CalendarClock, Check, GitBranch, UserX, X } from "lucide-react";
import { cancelVisit, closeVisit, scheduleVisit } from "@/app/(app)/visitas/actions";
import { memberLabel, type TeamMember } from "@/lib/team/labels";
import type { VisitRow } from "@/lib/visits/queries";
import { cn } from "@/lib/utils";

export const VISIT_TONE: Record<string, string> = {
  solicitada: "bg-accent-amber/12 text-accent-amber",
  agendada: "bg-accent-blue/12 text-accent-blue",
  realizada: "bg-accent-green/12 text-accent-green",
  no_asistio: "bg-accent-red/10 text-accent-red",
  cancelada: "bg-field text-muted",
};

export const VISIT_LABEL: Record<string, string> = {
  solicitada: "Solicitada",
  agendada: "Agendada",
  realizada: "Realizada",
  no_asistio: "No asistió",
  cancelada: "Cancelada",
};

const dateTime = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

// El input datetime-local necesita "YYYY-MM-DDTHH:mm" en hora local, no un ISO con zona.
function toLocalInput(iso: string | null) {
  const d = iso ? new Date(iso) : new Date(Date.now() + 24 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type Panel = "agendar" | "resultado" | "cancelar" | null;

export function VisitCard({ visit, team, back }: { visit: VisitRow; team: TeamMember[]; back: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const closed = ["realizada", "no_asistio", "cancelada"].includes(visit.status);
  const overdue =
    visit.status === "agendada" && visit.scheduledAt !== null && new Date(visit.scheduledAt) < new Date();

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-md px-2 py-0.5 text-[11.5px] font-medium", VISIT_TONE[visit.status])}>
              {VISIT_LABEL[visit.status]}
            </span>
            {overdue && (
              <span className="rounded-md bg-accent-amber/12 px-2 py-0.5 text-[11.5px] font-medium text-accent-amber">
                Pasó la fecha, falta cargar el resultado
              </span>
            )}
            {visit.fromPresentation && (
              <span className="rounded-md bg-field px-2 py-0.5 text-[11.5px] text-muted">Desde la red</span>
            )}
            {visit.propertyStatus !== "disponible" && (
              <span className="rounded-md bg-accent-amber/12 px-2 py-0.5 text-[11.5px] font-medium text-accent-amber">
                Propiedad {visit.propertyStatus}
              </span>
            )}
          </div>

          <p className="mt-1.5 flex items-center gap-1.5 text-[14px] font-semibold text-ink">
            <Building2 className="size-3.5 shrink-0 text-muted" strokeWidth={1.7} />
            <span className="truncate">{visit.propertyTitle}</span>
            {visit.propertyZone && <span className="shrink-0 text-[12.5px] font-normal text-muted">· {visit.propertyZone}</span>}
          </p>

          <p className="mt-0.5 text-[12.5px] text-muted">
            {visit.contactName}
            {visit.contactPhone ? ` · ${visit.contactPhone}` : ""}
            {" · "}
            <Link href={`/pipeline/${visit.dealId}`} className="inline-flex items-center gap-1 hover:underline">
              <GitBranch className="size-3" strokeWidth={1.8} />
              {visit.dealTitle}
            </Link>
          </p>

          <p className="mt-1 text-[12.5px] text-muted">
            {visit.scheduledAt ? (
              <>
                <CalendarClock className="mb-0.5 mr-1 inline size-3.5" strokeWidth={1.7} />
                {dateTime.format(new Date(visit.scheduledAt))}
              </>
            ) : (
              "Sin fecha confirmada"
            )}
            {" · "}
            {memberLabel(team, visit.assignedUserId)}
          </p>

          {visit.notes && <p className="mt-1.5 text-[12.5px] text-ink">{visit.notes}</p>}
          {visit.cancelReason && (
            <p className="mt-1.5 text-[12.5px] text-muted">Motivo: {visit.cancelReason}</p>
          )}
        </div>

        {!closed && (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "agendar" ? null : "agendar"))}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink hover:bg-field"
            >
              <CalendarClock className="size-3.5" strokeWidth={1.7} />
              {visit.scheduledAt ? "Reprogramar" : "Confirmar fecha"}
            </button>
            {visit.status === "agendada" && (
              <button
                type="button"
                onClick={() => setPanel((p) => (p === "resultado" ? null : "resultado"))}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink hover:bg-field"
              >
                <Check className="size-3.5" strokeWidth={1.8} />
                Resultado
              </button>
            )}
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "cancelar" ? null : "cancelar"))}
              aria-label="Cancelar visita"
              title="Cancelar visita"
              className="grid size-8 place-items-center rounded-lg border border-line bg-card text-muted hover:bg-field hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={1.8} />
            </button>
          </div>
        )}
      </div>

      {panel === "agendar" && (
        <form action={scheduleVisit} className="mt-3 rounded-lg bg-field p-3.5">
          <input type="hidden" name="visitId" value={visit.id} />
          <input type="hidden" name="back" value={back} />
          <label className="block text-[13px] font-medium text-ink" htmlFor={`when-${visit.id}`}>
            Fecha y hora
          </label>
          <input
            id={`when-${visit.id}`}
            type="datetime-local"
            name="scheduledAt"
            required
            defaultValue={toLocalInput(visit.scheduledAt)}
            className="mt-1.5 h-9 w-full max-w-xs rounded-lg border border-line bg-card px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none"
          />
          {visit.scheduledAt && (
            <p className="mt-1.5 text-[12px] text-muted">La fecha anterior queda en el historial.</p>
          )}
          <button
            type="submit"
            className="mt-3 inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover"
          >
            Guardar
          </button>
        </form>
      )}

      {panel === "resultado" && (
        <div className="mt-3 rounded-lg bg-field p-3.5">
          <p className="text-[13px] font-medium text-ink">¿Cómo salió?</p>
          <form action={closeVisit} className="mt-2">
            <input type="hidden" name="visitId" value={visit.id} />
            <input type="hidden" name="back" value={back} />
            <textarea
              name="notes"
              rows={2}
              placeholder="Nota de seguimiento: qué dijo, qué sigue…"
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-[13.5px] text-ink focus:border-primary focus:outline-none"
            />
            <div className="mt-2.5 flex gap-2">
              <button
                type="submit"
                name="outcome"
                value="realizada"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover"
              >
                <Check className="size-4" strokeWidth={1.8} />
                Realizada
              </button>
              <button
                type="submit"
                name="outcome"
                value="no_asistio"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-canvas"
              >
                <UserX className="size-4" strokeWidth={1.7} />
                No asistió
              </button>
            </div>
          </form>
        </div>
      )}

      {panel === "cancelar" && (
        <form action={cancelVisit} className="mt-3 rounded-lg bg-field p-3.5">
          <input type="hidden" name="visitId" value={visit.id} />
          <input type="hidden" name="back" value={back} />
          <label className="block text-[13px] font-medium text-ink" htmlFor={`cancel-${visit.id}`}>
            Motivo de la cancelación
          </label>
          <input
            id={`cancel-${visit.id}`}
            name="cancelReason"
            required
            placeholder="El cliente no puede, se vendió la propiedad…"
            className="mt-1.5 h-9 w-full rounded-lg border border-line bg-card px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none"
          />
          <p className="mt-1.5 text-[12px] text-muted">La visita no se borra: queda cancelada con su historial.</p>
          <button
            type="submit"
            className="mt-3 inline-flex h-9 items-center rounded-lg bg-accent-red px-3.5 text-[13.5px] font-medium text-white hover:opacity-90"
          >
            Cancelar visita
          </button>
        </form>
      )}
    </li>
  );
}
