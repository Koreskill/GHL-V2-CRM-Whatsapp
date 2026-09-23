import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { agentConfigs, type Channel } from "@/db/schema";
import { TOOL_NAMES, type ToolName } from "./tools";

export const DEFAULT_SYSTEM_PROMPT = `Sos el asistente comercial del negocio y respondés mensajes de clientes potenciales.
- Respondé en español rioplatense, con mensajes cortos (1 a 3 oraciones), claros y amables.
- Tu objetivo es entender qué necesita la persona y conseguir los datos para que un asesor la contacte.
- No inventes precios, disponibilidad, direcciones ni condiciones. Si no sabés algo, decí que un asesor lo confirma.
- Si la persona pide hablar con una persona, está molesta o el tema excede lo comercial, usá la herramienta handoff_to_human.`;

export const DEFAULT_MODEL = () => process.env.OPENAI_MODEL || "gpt-4.1-mini";

export type ResolvedAgentConfig = {
  enabled: boolean;
  systemPrompt: string;
  model: string;
  tools: ToolName[];
};

type Row = typeof agentConfigs.$inferSelect;

// Cascada: config del canal -> config global -> default del código. `enabled` es solo del canal.
export function mergeAgentConfig(channelRow: Row | undefined, globalRow: Row | undefined): ResolvedAgentConfig {
  const pick = <K extends "systemPrompt" | "model" | "enabledTools">(key: K) => {
    const v = channelRow?.[key];
    const hasValue = Array.isArray(v) ? true : typeof v === "string" ? v.trim() !== "" : v != null;
    return hasValue ? v : globalRow?.[key];
  };
  const tools = (pick("enabledTools") as string[] | null | undefined) ?? [...TOOL_NAMES];
  return {
    enabled: channelRow?.enabled ?? false,
    systemPrompt: (pick("systemPrompt") as string | null | undefined)?.trim() || DEFAULT_SYSTEM_PROMPT,
    model: (pick("model") as string | null | undefined)?.trim() || DEFAULT_MODEL(),
    tools: tools.filter((t): t is ToolName => (TOOL_NAMES as readonly string[]).includes(t)),
  };
}

export async function resolveAgentConfig(channel: Channel): Promise<ResolvedAgentConfig> {
  const rows = await getDb().select().from(agentConfigs).where(inArray(agentConfigs.scope, [channel, "global"]));
  return mergeAgentConfig(
    rows.find((r) => r.scope === channel),
    rows.find((r) => r.scope === "global"),
  );
}
