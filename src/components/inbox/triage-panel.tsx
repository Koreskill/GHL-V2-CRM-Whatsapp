"use client";

import { useState } from "react";
import { AlertTriangle, Bot, ChevronDown, Info, PencilLine, Send, X } from "lucide-react";
import type { TriageRow } from "@/lib/agent/triage/queries";
import { INTENT_LABEL, type Intent } from "@/lib/agent/triage/questions";
import { ROUTE_LABEL, type Route } from "@/lib/agent/triage/routes";
import { cn } from "@/lib/utils";

const URGENCY_TONE: Record<string, string> = {
  bajo: "bg-field text-muted",
  medio: "bg-accent-blue/12 text-accent-blue",
  alto: "bg-accent-red/10 text-accent-red",
};

/**
 * Lo que el agente decidió sobre el último mensaje.
 *
 * Solo aparece cuando hay algo que hacer: un borrador por revisar o un caso derivado. Si la
 * respuesta salió sola, no molesta con un panel.
 *
 * El borrador NO se envía solo desde acá: se carga en el campo de escritura para que la persona
 * lo lea, lo corrija y lo mande. Así el único camino de salida sigue siendo el mismo.
 */
export function TriagePanel({
  triage,
  onUseDraft,
  onDismiss,
}: {
  triage: TriageRow;
  onUseDraft: (text: string) => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(true);
  if (triage.status !== "borrador" && triage.status !== "derivado") return null;

  const derivado = triage.status === "derivado";
  const intent = triage.intent as Intent | null;
  const route = triage.route as Route | null;

  return (
    <div
      className={cn(
        "shrink-0 border-b px-6 py-3",
        derivado ? "border-accent-amber/30 bg-accent-amber/5" : "border-line bg-field/60",
      )}
    >
      <div className="flex items-start gap-2.5">
        {derivado ? (
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-amber" strokeWidth={1.8} />
        ) : (
          <Bot className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.8} />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13.5px] font-semibold text-ink">
              {derivado ? "Necesita que lo veas vos" : "Borrador listo para revisar"}
            </p>
            {intent && (
              <span className="rounded-md bg-card px-2 py-0.5 text-[11.5px] font-medium text-muted">
                {INTENT_LABEL[intent] ?? intent}
              </span>
            )}
            {triage.urgency && (
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11.5px] font-medium",
                  URGENCY_TONE[triage.urgency] ?? "bg-field text-muted",
                )}
              >
                Urgencia {triage.urgency}
              </span>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-muted hover:text-ink"
            >
              {open ? "Ocultar" : "Ver detalle"}
              <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Descartar"
              title="Descartar"
              className="grid size-6 place-items-center rounded-md text-muted hover:bg-card hover:text-ink"
            >
              <X className="size-3.5" strokeWidth={1.8} />
            </button>
          </div>

          {/* El motivo primero: es lo que explica por qué no salió sola. */}
          <p className="mt-1 text-[12.5px] text-muted">
            {triage.handoffReason ?? triage.routeReason ?? (route ? ROUTE_LABEL[route] : "")}
          </p>

          {open && (
            <>
              {triage.draftText && (
                <div className="mt-2.5 rounded-lg border border-line bg-card p-3">
                  <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
                    {triage.draftText}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onUseDraft(triage.draftText!)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-medium text-white hover:bg-primary-hover"
                    >
                      <PencilLine className="size-3.5" strokeWidth={1.8} />
                      Usar y editar
                    </button>
                    <span className="inline-flex h-8 items-center gap-1.5 text-[12px] text-muted">
                      <Send className="size-3.5" strokeWidth={1.7} />
                      No se envió: lo revisás vos antes
                    </span>
                  </div>
                </div>
              )}

              {triage.internalSummary && (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-muted">
                  <Info className="mt-px size-3.5 shrink-0" strokeWidth={1.7} />
                  {triage.internalSummary}
                </p>
              )}

              {triage.missingInformation.length > 0 && (
                <p className="mt-1.5 text-[12.5px] text-muted">
                  Faltan datos: {triage.missingInformation.join(", ")}
                </p>
              )}

              {/* Las probabilidades quedan a mano: sin esto no se entiende una clasificación rara. */}
              <p className="mt-1.5 text-[11.5px] text-muted/80">
                {triage.intentConfidence !== null && `Confianza ${triage.intentConfidence.toFixed(2)}`}
                {triage.requiresHuman !== null && ` · Necesita persona ${triage.requiresHuman.toFixed(2)}`}
                {triage.containsVisitRequest !== null &&
                  ` · Pide visita ${triage.containsVisitRequest.toFixed(2)}`}
                {triage.decisionModel && ` · ${triage.decisionModel}`}
                {triage.replyModel && ` + ${triage.replyModel}`}
              </p>

              {triage.error && (
                <p className="mt-1.5 text-[12px] text-accent-red">{triage.error}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
