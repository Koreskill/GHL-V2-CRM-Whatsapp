"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Bell, MessageCircle } from "lucide-react";
import { formatListDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export type HandoverItem = {
  id: string;
  conversationId: string;
  contactName: string | null;
  channel: string;
  intent: string | null;
  urgency: string | null;
  routeReason: string | null;
  handoffReason: string | null;
  internalSummary: string | null;
  temperature: string | null;
  buscaResumen: string | null;
  ultimaPropiedad: string | null;
  status: string;
  seen: boolean;
  createdAt: string;
};

const URGENCY_TONE: Record<string, string> = {
  alto: "bg-accent-red/10 text-accent-red",
  medio: "bg-accent-blue/12 text-accent-blue",
  bajo: "bg-field text-muted",
};

/**
 * Campanita con las conversaciones que el bot dejó para una persona.
 * Solo cuenta las NO vistas: si no, el número queda clavado y deja de significar algo.
 */
export function HandoverBell({ items }: { items: HandoverItem[] }) {
  const [open, setOpen] = useState(false);
  const unseen = items.filter((i) => !i.seen).length;

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        aria-label={unseen ? `${unseen} conversaciones esperando atención` : "Notificaciones"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative grid size-9 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink"
      >
        <Bell className="size-[18px]" strokeWidth={1.7} />
        {unseen > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-accent-red px-1 text-[10px] font-semibold text-white">
            {unseen > 9 ? "9+" : unseen}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Capa para cerrar al hacer clic afuera, sin listeners globales. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 z-50 mt-2 w-[380px] overflow-hidden rounded-card border border-line bg-card shadow-card">
            <div className="border-b border-line px-4 py-3">
              <p className="text-[14px] font-semibold text-ink">Atención requerida</p>
              <p className="text-[12px] text-muted">
                {items.length === 0
                  ? "No hay nada esperando."
                  : `${items.length} conversación${items.length === 1 ? "" : "es"} que el agente dejó para el equipo.`}
              </p>
            </div>

            {items.length > 0 && (
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {items.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`/conversaciones/${i.conversationId}`}
                      onClick={() => setOpen(false)}
                      className={cn("block px-4 py-3 hover:bg-field", !i.seen && "bg-accent-amber/5")}
                    >
                      <div className="flex items-center gap-2">
                        {i.status === "derivado" && (
                          <AlertTriangle className="size-3.5 shrink-0 text-accent-amber" strokeWidth={1.9} />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
                          {i.contactName ?? "Sin nombre"}
                        </span>
                        {i.urgency && (
                          <span
                            className={cn(
                              "shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium",
                              URGENCY_TONE[i.urgency] ?? "bg-field text-muted",
                            )}
                          >
                            {i.urgency}
                          </span>
                        )}
                        <span className="shrink-0 text-[11px] text-muted">{formatListDate(i.createdAt)}</span>
                      </div>

                      {/* El motivo primero: es lo que decide si hay que atenderlo ya. */}
                      <p className="mt-1 line-clamp-2 text-[12.5px] text-muted">
                        {i.handoffReason ?? i.routeReason ?? i.internalSummary ?? "Necesita revisión"}
                      </p>

                      {(i.buscaResumen || i.ultimaPropiedad) && (
                        <p className="mt-1 truncate text-[11.5px] text-muted/80">
                          {i.buscaResumen}
                          {i.buscaResumen && i.ultimaPropiedad && " · "}
                          {i.ultimaPropiedad && `Última propiedad: ${i.ultimaPropiedad}`}
                        </p>
                      )}

                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted/80">
                        <MessageCircle className="size-3" strokeWidth={1.8} />
                        {i.channel}
                        {i.temperature && ` · ${i.temperature}`}
                        {i.status === "borrador" && " · hay un borrador listo"}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
