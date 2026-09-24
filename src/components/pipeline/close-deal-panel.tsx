"use client";

import { useState } from "react";
import { RotateCcw, Trophy, XCircle } from "lucide-react";
import { closeDeal, reopenDeal } from "@/app/(app)/pipeline/actions";
import { Card } from "@/components/ui/primitives";
import type { DealStatus } from "@/db/schema";

/**
 * Cerrar la oportunidad.
 * Perder NO obliga a pasar por "Cerrado ganado": la etapa donde estaba se conserva, que es el dato
 * que sirve para saber en qué punto se caen las ventas.
 */
export function CloseDealPanel({
  dealId,
  status,
  stageLabel,
}: {
  dealId: string;
  status: DealStatus;
  stageLabel: string;
}) {
  const [losing, setLosing] = useState(false);

  if (status !== "abierta") {
    return (
      <Card className="p-5">
        <h2 className="text-[15px] font-semibold text-ink">Cerrada</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
          Ya no aparece en el tablero. Reabrirla la devuelve a {stageLabel}.
        </p>
        <form action={reopenDeal} className="mt-3">
          <input type="hidden" name="dealId" value={dealId} />
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <RotateCcw className="size-4" strokeWidth={1.7} />
            Reabrir
          </button>
        </form>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-semibold text-ink">Cerrar oportunidad</h2>

      {losing ? (
        <form action={closeDeal} className="mt-3">
          <input type="hidden" name="dealId" value={dealId} />
          <input type="hidden" name="outcome" value="perdida" />
          <label className="block text-[13px] font-medium text-ink" htmlFor="lostReason">
            Motivo de la pérdida
          </label>
          <textarea
            id="lostReason"
            name="lostReason"
            rows={3}
            required
            placeholder="Compró en otra inmobiliaria, se fue de presupuesto, dejó de responder…"
            className="mt-1.5 w-full rounded-lg border border-line bg-field px-3 py-2 text-[13.5px] text-ink focus:border-primary focus:outline-none"
          />
          <p className="mt-1.5 text-[12px] text-muted">Queda registrada como perdida en {stageLabel}.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-lg bg-accent-red px-3.5 text-[13.5px] font-medium text-white hover:opacity-90"
            >
              Marcar perdida
            </button>
            <button
              type="button"
              onClick={() => setLosing(false)}
              className="inline-flex h-9 items-center rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
            >
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <form action={closeDeal}>
            <input type="hidden" name="dealId" value={dealId} />
            <input type="hidden" name="outcome" value="ganada" />
            <button
              type="submit"
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover"
            >
              <Trophy className="size-4" strokeWidth={1.7} />
              Marcar ganada
            </button>
          </form>
          <button
            type="button"
            onClick={() => setLosing(true)}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <XCircle className="size-4" strokeWidth={1.7} />
            Marcar perdida
          </button>
        </div>
      )}
    </Card>
  );
}
