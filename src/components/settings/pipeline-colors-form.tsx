"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { DEAL_STAGES } from "@/lib/pipeline";
import { COLOR_PRESETS, DEFAULT_STAGE_COLORS, presetFor, type StageColors } from "@/lib/pipeline-colors";
import { cn } from "@/lib/utils";

export function PipelineColorsForm({
  initial,
  action,
}: {
  initial: StageColors;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const [colors, setColors] = useState<StageColors>(initial);

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-4">
        {DEAL_STAGES.map((stage) => {
          const preset = presetFor(colors[stage.id]);
          return (
            <fieldset key={stage.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-line p-4">
              <legend className="sr-only">Color de {stage.label}</legend>
              <div className={cn("flex w-48 items-center gap-2 rounded-lg px-3 py-2", preset.tint)}>
                <span className={cn("size-2.5 rounded-full", preset.dot)} />
                <span className="text-[13.5px] font-semibold text-ink">{stage.label}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((p) => (
                  <label key={p.id} title={p.label} className="cursor-pointer">
                    <input
                      type="radio"
                      name={`color_${stage.id}`}
                      value={p.id}
                      checked={colors[stage.id] === p.id}
                      onChange={() => setColors((c) => ({ ...c, [stage.id]: p.id }))}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        "block size-7 rounded-full ring-offset-2 ring-offset-card transition peer-checked:ring-2 peer-focus-visible:ring-2",
                        p.dot,
                        p.ring,
                      )}
                    />
                    <span className="sr-only">{p.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="flex gap-2">
        <Button type="submit">Guardar colores</Button>
        <Button type="button" variant="secondary" onClick={() => setColors(DEFAULT_STAGE_COLORS)}>
          Restaurar
        </Button>
      </div>
    </form>
  );
}
