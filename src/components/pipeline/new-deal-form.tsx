"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Building2, Check } from "lucide-react";
import { createDeal } from "@/app/(app)/pipeline/actions";
import type { PropertyOption } from "@/lib/deals/properties";
import type { TeamMember } from "@/lib/team/labels";
import { DEAL_STAGES } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

type ContactOption = { id: string; name: string | null; phone: string | null };

const inputClass =
  "mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[14px] text-ink focus:border-primary focus:outline-none";
const labelClass = "block text-[13px] font-medium text-ink";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[14px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? "Creando…" : "Crear oportunidad"}
    </button>
  );
}

export function NewDealForm({
  contacts,
  team,
  properties,
  preselectContact,
}: {
  contacts: ContactOption[];
  team: TeamMember[];
  properties: PropertyOption[];
  preselectContact: string | null;
}) {
  // Las propiedades de interés se eligen acá: una oportunidad puede nacer con varias.
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const visible = search.trim()
    ? properties.filter((p) =>
        `${p.title} ${p.zone ?? ""} ${p.operation} ${p.propertyType}`.toLowerCase().includes(search.toLowerCase()),
      )
    : properties;

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <form action={createDeal} className="flex flex-col gap-4">
      <div>
        <label className={labelClass} htmlFor="contactId">
          Contacto
        </label>
        <select id="contactId" name="contactId" required defaultValue={preselectContact ?? ""} className={inputClass}>
          <option value="" disabled>
            Elige un contacto
          </option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name ?? "Sin nombre"}
              {c.phone ? ` · ${c.phone}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass} htmlFor="title">
          Título
        </label>
        <input
          id="title"
          name="title"
          placeholder="Depto 2 amb en Palermo hasta USD 120.000"
          className={inputClass}
        />
        <p className="mt-1.5 text-[12px] text-muted">
          Opcional. Si lo dejas vacío se usa el nombre del contacto.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass} htmlFor="stage">
            Etapa inicial
          </label>
          <select id="stage" name="stage" defaultValue="prospecto" className={inputClass}>
            {DEAL_STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="assignedUserId">
            Responsable
          </label>
          <select id="assignedUserId" name="assignedUserId" defaultValue="" className={inputClass}>
            <option value="">Sin asignar</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email}
              </option>
            ))}
          </select>
          {team.length === 0 && (
            <p className="mt-1.5 text-[12px] text-muted">
              No se pudo leer el equipo de la inmobiliaria. Falta SUPABASE_SECRET_KEY.
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <div>
          <label className={labelClass} htmlFor="value">
            Valor de la oportunidad
          </label>
          <input id="value" name="value" inputMode="decimal" placeholder="Opcional" className={inputClass} />
          <p className="mt-1.5 text-[12px] text-muted">
            Es lo que vale el negocio para la inmobiliaria, no el precio de la propiedad.
          </p>
        </div>
        <div>
          <label className={labelClass} htmlFor="currency">
            Moneda
          </label>
          <select id="currency" name="currency" defaultValue="USD" className={inputClass}>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
        </div>
      </div>

      <div>
        <p className={labelClass}>Propiedades de interés</p>
        {properties.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-muted">
            Todavía no hay propiedades cargadas. Podés vincularlas después desde la ficha.
          </p>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, zona u operación"
              className={inputClass}
            />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-line">
              {visible.length === 0 ? (
                <p className="px-3 py-4 text-[13px] text-muted">Ninguna propiedad coincide.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {visible.map((p) => {
                    const on = selected.includes(p.id);
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => toggle(p.id)}
                          aria-pressed={on}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-field",
                            on && "bg-primary/5",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-4 shrink-0 place-items-center rounded border",
                              on ? "border-primary bg-primary text-white" : "border-line bg-card",
                            )}
                          >
                            {on && <Check className="size-3" strokeWidth={3} />}
                          </span>
                          <Building2 className="size-3.5 shrink-0 text-muted" strokeWidth={1.7} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-ink">{p.title}</span>
                            <span className="block truncate text-[11.5px] text-muted">
                              {p.operation} · {p.propertyType}
                              {p.zone ? ` · ${p.zone}` : ""}
                              {p.price !== null ? ` · ${p.currency} ${p.price.toLocaleString("es-AR")}` : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <p className="mt-1.5 text-[12px] text-muted">
              {selected.length} seleccionada{selected.length === 1 ? "" : "s"}
            </p>
          </>
        )}
        {selected.map((id) => (
          <input key={id} type="hidden" name="propertyIds" value={id} />
        ))}
      </div>

      <div>
        <label className={labelClass} htmlFor="notes">
          Notas
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          className="mt-1.5 w-full rounded-lg border border-line bg-field px-3 py-2 text-[14px] text-ink focus:border-primary focus:outline-none"
        />
      </div>

      <Submit />
    </form>
  );
}
