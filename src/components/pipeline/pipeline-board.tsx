"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { moveDealStageAction } from "@/app/(app)/pipeline/actions";
import { Card } from "@/components/ui/primitives";
import type { DealStage } from "@/db/schema";
import { DEAL_STAGES } from "@/lib/pipeline";
import { presetFor, type StageColors } from "@/lib/pipeline-colors";
import { cn } from "@/lib/utils";

export type BoardCard = { id: string; stage: DealStage; value: number | null };

const usd = (n: number) => `USD ${n.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

/**
 * Tablero con arrastre. El contenido de cada tarjeta lo arma el servidor (`bodies`); acá solo se
 * decide en qué columna está. Se mueve al soltar (optimista) y, si el servidor falla, vuelve a su
 * columna. El selector dentro de cada tarjeta sigue siendo la forma de mover con teclado o desde el teléfono.
 */
export function PipelineBoard({
  cards,
  bodies,
  colors,
}: {
  cards: BoardCard[];
  bodies: Record<string, ReactNode>;
  colors: StageColors;
}) {
  const [stages, setStages] = useState<Record<string, DealStage>>(() => Object.fromEntries(cards.map((c) => [c.id, c.stage])));
  const [over, setOver] = useState<DealStage | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Tarjetas con un guardado en curso: un segundo drop sobre la misma no escribe otro evento.
  const inFlight = useRef(new Set<string>());

  async function move(id: string, to: DealStage) {
    const from = stages[id];
    if (!from || from === to || inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setMessage(null);
    setStages((s) => ({ ...s, [id]: to }));
    const res = await moveDealStageAction(id, to).catch(() => ({ ok: false as const, error: "No se pudo guardar el cambio." }));
    inFlight.current.delete(id);
    if (!res.ok) {
      setStages((s) => ({ ...s, [id]: from }));
      setMessage(res.error);
    }
  }

  function onDrop(e: DragEvent, to: DealStage) {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData("text/plain") || dragging;
    setDragging(null);
    if (id) void move(id, to);
  }

  return (
    <>
      <p role="status" aria-live="polite" className={cn("mb-3 rounded-lg px-3 py-2 text-[13px]", message ? "bg-accent-red/10 text-accent-red" : "sr-only")}>
        {message}
      </p>
      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3">
        {DEAL_STAGES.map((stage) => {
          const preset = presetFor(colors[stage.id]);
          const column = cards.filter((c) => stages[c.id] === stage.id);
          const total = column.reduce((sum, c) => sum + (c.value ?? 0), 0);
          const isOver = over === stage.id;
          return (
            <Card
              key={stage.id}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(stage.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => onDrop(e, stage.id)}
              className={cn("flex w-72 shrink-0 flex-col p-4 transition-colors", preset.tint, isOver && "ring-2", isOver && preset.ring)}
            >
              <div className="flex items-center gap-2">
                <span className={cn("size-2.5 rounded-full", preset.dot)} />
                <h2 className="text-[14px] font-semibold text-ink">{stage.label}</h2>
                <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">{column.length}</span>
              </div>
              <p className="mt-1 text-[12px] text-muted">{total > 0 ? `${usd(total)} en valor cargado` : "Sin valor cargado"}</p>

              {column.length === 0 ? (
                <div className={cn("mt-4 grid flex-1 place-items-center rounded-xl border border-dashed py-10", isOver ? "border-ink/40" : "border-line")}>
                  <p className="text-[13px] text-muted">{isOver ? "Soltá acá" : "Sin deals en esta etapa"}</p>
                </div>
              ) : (
                <ul className="mt-4 flex flex-1 flex-col gap-2.5 overflow-y-auto">
                  {column.map((c) => (
                    <li
                      key={c.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", c.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragging(c.id);
                      }}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                      className={cn(
                        "cursor-grab rounded-xl border border-line bg-card p-3 active:cursor-grabbing",
                        dragging === c.id && "opacity-40",
                      )}
                    >
                      {bodies[c.id]}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
