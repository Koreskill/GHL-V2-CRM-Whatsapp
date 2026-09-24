import type { DealStage } from "@/db/schema";

// Las cinco etapas del tablero. El orden es el del embudo y define las columnas.
export const DEAL_STAGES = [
  { id: "prospecto", label: "Prospecto", dot: "bg-accent-slate" },
  { id: "contactado", label: "Contactado", dot: "bg-accent-blue" },
  { id: "propuesta", label: "Propuesta", dot: "bg-accent-purple" },
  { id: "negociacion", label: "Negociación", dot: "bg-accent-orange" },
  { id: "cerrado_ganado", label: "Cerrado Ganado", dot: "bg-accent-green" },
] as const satisfies readonly { id: DealStage; label: string; dot: string }[];

export const STAGE_LABEL = Object.fromEntries(DEAL_STAGES.map((s) => [s.id, s.label])) as Record<DealStage, string>;

// Nombre anterior, mantenido para no romper importaciones existentes.
export const PIPELINE_STAGES = DEAL_STAGES;
