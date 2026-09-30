"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

/**
 * Panel lateral accesible: toma el foco al abrir, se cierra con Escape o tocando el fondo, y devuelve
 * el foco al elemento que lo abrió. En pantallas chicas ocupa toda la pantalla.
 */
export function PanelShell({ closeHref, title, children }: { closeHref: string; title: string; children: ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [closeHref, router]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="Cerrar panel" tabIndex={-1} onClick={() => router.push(closeHref, { scroll: false })} className="absolute inset-0 bg-black/30" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full w-full flex-col overflow-y-auto border-l border-line bg-card shadow-card outline-none sm:w-[460px]"
      >
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-card px-5 py-4">
          <h2 className="min-w-0 flex-1 truncate text-[16px] font-semibold text-ink">{title}</h2>
          <button type="button" onClick={() => router.push(closeHref, { scroll: false })} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink">
            <X className="size-4" strokeWidth={1.8} />
            <span className="sr-only">Cerrar</span>
          </button>
        </div>
        <div className="flex flex-col gap-5 p-5">{children}</div>
      </div>
    </div>
  );
}
