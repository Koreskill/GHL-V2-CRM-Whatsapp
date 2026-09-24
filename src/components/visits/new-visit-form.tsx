"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { requestVisit } from "@/app/(app)/visitas/actions";
import type { TeamMember } from "@/lib/team/labels";

export type VisitTarget = {
  dealId: string;
  label: string;
  contactId: string;
  properties: { id: string; label: string }[];
};

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[14px] text-ink focus:border-primary focus:outline-none";
const labelClass = "block text-[13px] font-medium text-ink";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 inline-flex h-10 w-fit items-center rounded-lg bg-primary px-4 text-[14px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? "Guardando…" : "Crear visita"}
    </button>
  );
}

/**
 * Una visita es siempre a UNA propiedad dentro de UNA oportunidad, así que primero se elige la
 * oportunidad y después, entre sus propiedades de interés, cuál se va a visitar.
 * La fecha es opcional: sin fecha la visita queda "solicitada"; con fecha nace "agendada".
 */
export function NewVisitForm({
  targets,
  team,
  back,
  defaultDealId,
}: {
  targets: VisitTarget[];
  team: TeamMember[];
  back: string;
  defaultDealId?: string | null;
}) {
  const initial = targets.find((t) => t.dealId === defaultDealId) ?? targets[0];
  const [dealId, setDealId] = useState(initial?.dealId ?? "");
  const selected = targets.find((t) => t.dealId === dealId);

  return (
    <form action={requestVisit} className="flex flex-col gap-4">
      <input type="hidden" name="back" value={back} />

      <div>
        <label className={labelClass} htmlFor="dealId">
          Oportunidad
        </label>
        <select
          id="dealId"
          name="dealId"
          required
          value={dealId}
          onChange={(e) => setDealId(e.target.value)}
          className={inputClass}
        >
          {targets.map((t) => (
            <option key={t.dealId} value={t.dealId}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="propertyId">
          Propiedad
        </label>
        {/* key fuerza a React a rehacer el select cuando cambia la oportunidad, para que no
            quede seleccionada una propiedad de la oportunidad anterior. */}
        <select key={dealId} id="propertyId" name="propertyId" required className={inputClass}>
          {selected?.properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-[12px] text-muted">
          Solo aparecen las propiedades vinculadas a esa oportunidad.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="scheduledAt">
            Fecha y hora
          </label>
          <input id="scheduledAt" type="datetime-local" name="scheduledAt" className={inputClass} />
          <p className="mt-1.5 text-[12px] text-muted">
            Opcional. Sin fecha queda como solicitada, para coordinar con el cliente.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="assignedUserId">
            Asesor
          </label>
          <select id="assignedUserId" name="assignedUserId" defaultValue="" className={inputClass}>
            <option value="">Sin asignar</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notas
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          className="mt-1.5 w-full rounded-lg border border-line bg-field px-3 py-2 text-[14px] text-ink focus:border-primary focus:outline-none"
        />
      </div>

      <Submit />
    </form>
  );
}
