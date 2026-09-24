"use client";

import { useRef, useTransition } from "react";
import { moveDealStage } from "@/app/(app)/pipeline/actions";
import { DEAL_STAGES } from "@/lib/pipeline";
import type { DealStage } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * Mover una oportunidad de etapa con un selector.
 * Es la primera implementación a propósito: el drag-and-drop se agrega recién cuando se compruebe
 * que los cambios se guardan bien. Un select funciona con teclado y en el teléfono sin nada extra.
 */
export function StageSelect({
  dealId,
  stage,
  className,
}: {
  dealId: string;
  stage: DealStage;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form ref={formRef} action={moveDealStage} className={className}>
      <input type="hidden" name="dealId" value={dealId} />
      <select
        name="stage"
        defaultValue={stage}
        disabled={pending}
        aria-label="Etapa"
        onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        className={cn(
          "h-8 w-full rounded-md border border-line bg-card px-2 text-[12.5px] text-ink",
          "focus:border-primary focus:outline-none disabled:opacity-60",
        )}
      >
        {DEAL_STAGES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </form>
  );
}
