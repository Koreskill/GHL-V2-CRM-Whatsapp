import type { DealStage } from "@/db/schema";
import { DEAL_STAGES } from "@/lib/pipeline";

// Paleta cerrada: el servidor solo acepta estos ids, nunca CSS arbitrario. Las clases van escritas
// completas (no armadas con template strings) para que Tailwind las encuentre al compilar.
export const COLOR_PRESETS = [
  { id: "gray", label: "Gris", dot: "bg-accent-gray", tint: "bg-accent-gray/10", ring: "ring-accent-gray" },
  { id: "slate", label: "Pizarra", dot: "bg-accent-slate", tint: "bg-accent-slate/10", ring: "ring-accent-slate" },
  { id: "blue", label: "Azul", dot: "bg-accent-blue", tint: "bg-accent-blue/10", ring: "ring-accent-blue" },
  { id: "cyan", label: "Cian", dot: "bg-accent-cyan", tint: "bg-accent-cyan/10", ring: "ring-accent-cyan" },
  { id: "teal", label: "Turquesa", dot: "bg-accent-teal", tint: "bg-accent-teal/10", ring: "ring-accent-teal" },
  { id: "green", label: "Verde", dot: "bg-accent-green", tint: "bg-accent-green/10", ring: "ring-accent-green" },
  { id: "amber", label: "Ámbar", dot: "bg-accent-amber", tint: "bg-accent-amber/10", ring: "ring-accent-amber" },
  { id: "orange", label: "Naranja", dot: "bg-accent-orange", tint: "bg-accent-orange/10", ring: "ring-accent-orange" },
  { id: "red", label: "Rojo", dot: "bg-accent-red", tint: "bg-accent-red/10", ring: "ring-accent-red" },
  { id: "pink", label: "Rosa", dot: "bg-accent-pink", tint: "bg-accent-pink/10", ring: "ring-accent-pink" },
  { id: "purple", label: "Violeta", dot: "bg-accent-purple", tint: "bg-accent-purple/10", ring: "ring-accent-purple" },
  { id: "brown", label: "Marrón", dot: "bg-accent-brown", tint: "bg-accent-brown/10", ring: "ring-accent-brown" },
] as const;

export type ColorPresetId = (typeof COLOR_PRESETS)[number]["id"];
export type StageColors = Record<DealStage, ColorPresetId>;

const PRESET_BY_ID = new Map<string, (typeof COLOR_PRESETS)[number]>(COLOR_PRESETS.map((p) => [p.id, p]));
export const isPresetId = (value: unknown): value is ColorPresetId => typeof value === "string" && PRESET_BY_ID.has(value);

// Colores de fábrica: los que tenía el tablero antes de poder personalizarlos.
export const DEFAULT_STAGE_COLORS: StageColors = {
  prospecto: "slate",
  contactado: "blue",
  propuesta: "purple",
  negociacion: "orange",
  cerrado_ganado: "green",
};

/** Lee lo guardado en organizations.metadata y completa con los de fábrica. Ignora lo que no sea un preset. */
export function resolveStageColors(metadata: Record<string, unknown> | null | undefined): StageColors {
  const stored = (metadata?.pipelineColors ?? {}) as Record<string, unknown>;
  const out = { ...DEFAULT_STAGE_COLORS };
  for (const stage of DEAL_STAGES) {
    const value = stored[stage.id];
    if (isPresetId(value)) out[stage.id] = value;
  }
  return out;
}

export const presetFor = (id: ColorPresetId) => PRESET_BY_ID.get(id)!;
