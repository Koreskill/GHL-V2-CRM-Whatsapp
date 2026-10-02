"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Archive, ArrowLeftRight, Check, ChevronDown, ChevronUp, X, type LucideIcon } from "lucide-react";
import type { InboxTab } from "@/lib/inbox/status";
import { cn } from "@/lib/utils";

const KEY = "crm_inbox_tabs_collapsed";

// Preferencia por navegador. Se lee con useSyncExternalStore para no tocar localStorage al renderizar
// en el servidor ni sincronizar con un efecto.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};
const read = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

const TABS: { id: InboxTab; label: string; Icon: LucideIcon }[] = [
  { id: "activas", label: "Activas", Icon: Check },
  { id: "desactivas", label: "Desactivadas", Icon: X },
  { id: "archivadas", label: "Archivadas", Icon: Archive },
  { id: "delegadas", label: "Delegadas", Icon: ArrowLeftRight },
];

/**
 * Pestañas de estado de la bandeja: solo íconos, y la seleccionada se expande con su nombre y su
 * cantidad. Todo el bloque se puede plegar a una sola línea para ganar espacio.
 */
export function InboxTabs({ active, hrefs, counts }: { active: InboxTab; hrefs: Record<InboxTab, string>; counts: Record<InboxTab, number> }) {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);

  function toggle() {
    try {
      localStorage.setItem(KEY, collapsed ? "0" : "1");
    } catch {}
    listeners.forEach((cb) => cb());
  }

  const current = TABS.find((t) => t.id === active)!;
  const pendingDelegations = counts.delegadas > 0;

  return (
    <div className="mt-3 flex items-center gap-1.5">
      {collapsed ? (
        // Plegado: solo la pestaña activa, como recordatorio de dónde estás.
        <Link href={hrefs[active]} className="flex h-9 flex-1 items-center gap-2 rounded-xl bg-field px-3 text-[12.5px] font-medium text-ink">
          <current.Icon className="size-4" strokeWidth={2} />
          {current.label}
          <span className="rounded-md bg-line/60 px-1 text-[11px] text-muted">{counts[active]}</span>
        </Link>
      ) : (
        <div role="tablist" aria-label="Estado de las conversaciones" className="flex h-9 flex-1 gap-1 rounded-xl bg-field p-0.5">
          {TABS.map(({ id, label, Icon }) => {
            const on = id === active;
            return (
              <Link
                key={id}
                role="tab"
                aria-selected={on}
                aria-label={`${label} (${counts[id]})`}
                title={`${label} (${counts[id]})`}
                href={hrefs[id]}
                className={cn(
                  "relative flex items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium transition-all duration-200",
                  on ? "flex-[2.4] bg-card px-2.5 text-ink shadow-card" : "flex-1 text-muted hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={on ? 2.2 : 1.8} />
                {on && (
                  <>
                    <span className="truncate">{label}</span>
                    <span className="rounded-md bg-line/60 px-1 text-[11px] text-muted">{counts[id]}</span>
                  </>
                )}
                {/* Delegadas pendientes: se avisa aunque la pestaña esté cerrada. */}
                {!on && id === "delegadas" && pendingDelegations && <span className="absolute top-1 right-1.5 size-2 rounded-full bg-primary" />}
              </Link>
            );
          })}
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        title={collapsed ? "Mostrar las pestañas" : "Plegar las pestañas"}
        className="grid size-9 shrink-0 place-items-center rounded-xl text-muted hover:bg-field hover:text-ink"
      >
        {collapsed ? <ChevronDown className="size-4" strokeWidth={1.8} /> : <ChevronUp className="size-4" strokeWidth={1.8} />}
        <span className="sr-only">{collapsed ? "Mostrar las pestañas" : "Plegar las pestañas"}</span>
      </button>
    </div>
  );
}
