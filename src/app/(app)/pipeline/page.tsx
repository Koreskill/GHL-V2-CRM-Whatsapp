import { ArrowUpDown, ChevronDown, Columns3, List, SlidersHorizontal } from "lucide-react";
import { Button, Card } from "@/components/ui/primitives";
import { PIPELINE_STAGES } from "@/lib/pipeline";

export default function PipelinePage() {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center gap-3">
        <Button variant="secondary" className="h-10 text-[14px] font-semibold">
          Pipeline principal
          <ChevronDown className="size-4 text-muted" />
        </Button>
        <span className="text-[13px] text-muted">0 oportunidades</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-line bg-card p-0.5">
            <button aria-label="Vista kanban" className="grid size-8 place-items-center rounded-md bg-field text-ink">
              <Columns3 className="size-4" strokeWidth={1.7} />
            </button>
            <button aria-label="Vista lista" className="grid size-8 place-items-center rounded-md text-muted">
              <List className="size-4" strokeWidth={1.7} />
            </button>
          </div>
          <Button variant="secondary">
            <SlidersHorizontal className="size-4" strokeWidth={1.7} /> Filtros
          </Button>
          <Button variant="secondary">
            <ArrowUpDown className="size-4" strokeWidth={1.7} /> Ordenar
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-3">
        {PIPELINE_STAGES.map((stage) => (
          <Card key={stage.id} className="flex w-72 shrink-0 flex-col p-4">
            <div className="flex items-center gap-2">
              <span className={`size-2.5 rounded-full ${stage.dot}`} />
              <h2 className="text-[14px] font-semibold text-ink">{stage.label}</h2>
              <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">0</span>
            </div>
            <p className="mt-1 text-[12px] text-muted">$0.00 en valor total</p>
            <div className="mt-4 grid flex-1 place-items-center rounded-xl border border-dashed border-line py-10">
              <p className="text-[13px] text-muted">Sin deals en esta etapa</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
