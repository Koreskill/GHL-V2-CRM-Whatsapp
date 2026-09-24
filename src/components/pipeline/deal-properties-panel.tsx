"use client";

import { useState } from "react";
import { Building2, Plus, X } from "lucide-react";
import { linkProperty, unlinkProperty } from "@/app/(app)/pipeline/actions";
import { Card, EmptyState } from "@/components/ui/primitives";
import type { DealProperty } from "@/lib/deals/queries";
import { cn } from "@/lib/utils";

type Linkable = {
  id: string;
  title: string | null;
  operation: string;
  propertyType: string;
  price: number | null;
  currency: string;
  zone: string | null;
};

// Estado de la propiedad: si ya no está disponible, la ficha lo señala en vez de disimularlo.
const STATUS_TONE: Record<string, string> = {
  disponible: "bg-accent-green/12 text-accent-green",
  reservada: "bg-accent-amber/12 text-accent-amber",
  vendida: "bg-field text-muted",
  alquilada: "bg-field text-muted",
  pausada: "bg-field text-muted",
  borrador: "bg-field text-muted",
};

export function DealPropertiesPanel({
  dealId,
  linked,
  linkable,
}: {
  dealId: string;
  linked: DealProperty[];
  linkable: Linkable[];
}) {
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");

  const visible = search.trim()
    ? linkable.filter((p) =>
        `${p.title ?? ""} ${p.zone ?? ""} ${p.operation} ${p.propertyType}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      )
    : linkable;

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <Building2 className="size-4 text-muted" strokeWidth={1.7} />
        <h2 className="text-[15px] font-semibold text-ink">Propiedades de interés</h2>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
        >
          <Plus className="size-4" strokeWidth={2} />
          Vincular
        </button>
      </div>

      {adding && (
        <div className="border-b border-line bg-field/50 px-5 py-4">
          {linkable.length === 0 ? (
            <p className="text-[13px] text-muted">No quedan propiedades sin vincular.</p>
          ) : (
            <>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar propiedad"
                className="h-9 w-full rounded-lg border border-line bg-card px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none"
              />
              <ul className="mt-2 max-h-52 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-card">
                {visible.length === 0 ? (
                  <li className="px-3 py-3 text-[13px] text-muted">Ninguna coincide.</li>
                ) : (
                  visible.map((p) => (
                    <li key={p.id}>
                      <form action={linkProperty}>
                        <input type="hidden" name="dealId" value={dealId} />
                        <input type="hidden" name="propertyId" value={p.id} />
                        <button type="submit" className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-field">
                          <Plus className="size-3.5 shrink-0 text-primary" strokeWidth={2} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] text-ink">{p.title ?? "Sin título"}</span>
                            <span className="block truncate text-[11.5px] text-muted">
                              {p.operation} · {p.propertyType}
                              {p.zone ? ` · ${p.zone}` : ""}
                              {p.price !== null ? ` · ${p.currency} ${p.price.toLocaleString("es-AR")}` : ""}
                            </span>
                          </span>
                        </button>
                      </form>
                    </li>
                  ))
                )}
              </ul>
            </>
          )}
        </div>
      )}

      {linked.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Sin propiedades vinculadas"
          description="Vincula acá las propiedades por las que preguntó el contacto. Una oportunidad puede tener varias."
        />
      ) : (
        <ul className="divide-y divide-line">
          {linked.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-medium text-ink">{p.title}</span>
                <span className="block truncate text-[12px] text-muted">
                  {p.operation} · {p.propertyType}
                  {p.zone ? ` · ${p.zone}` : ""}
                  {p.city ? `, ${p.city}` : ""}
                  {p.price !== null ? ` · ${p.currency} ${p.price.toLocaleString("es-AR")}` : ""}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-medium",
                  STATUS_TONE[p.status] ?? "bg-field text-muted",
                )}
              >
                {p.status}
              </span>
              <form action={unlinkProperty}>
                <input type="hidden" name="dealId" value={dealId} />
                <input type="hidden" name="propertyId" value={p.propertyId} />
                <button
                  type="submit"
                  aria-label="Desvincular propiedad"
                  title="Desvincular"
                  className="grid size-8 place-items-center rounded-md text-muted hover:bg-field hover:text-ink"
                >
                  <X className="size-4" strokeWidth={1.8} />
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
