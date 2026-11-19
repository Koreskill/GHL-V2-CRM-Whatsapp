import { and, eq, inArray } from "drizzle-orm";
import { getDb, type DbExecutor } from "@/db";
import { agentConfigs, type Channel } from "@/db/schema";
import { activeFirstReplies, type FirstRepliesConfig } from "./first-replies";
import { TOOL_NAMES, type ToolName } from "./tools";

export const DEFAULT_SYSTEM_PROMPT = `Sos el asistente comercial del negocio y respondés mensajes de clientes potenciales.
- Respondé en español rioplatense, con mensajes cortos (1 a 3 oraciones), claros y amables.
- Tu objetivo es entender qué necesita la persona y conseguir los datos para que un asesor la contacte.
- No inventes precios, disponibilidad, direcciones ni condiciones. Si no sabés algo, decí que un asesor lo confirma.
- Si la persona pide hablar con una persona, está molesta o el tema excede lo comercial, usá la herramienta handoff_to_human.`;

// Modelo por defecto del agente. Slug de OpenRouter (proveedor/modelo).
export const DEFAULT_MODEL = () => process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";

export type ResolvedAgentConfig = {
  enabled: boolean;
  systemPrompt: string;
  /** Modelo que REDACTA. Null en la config = default del código. */
  model: string;
  /** Modelo que CLASIFICA (Jev). Null = se resuelve por ai_model_configs o por el env. */
  decisionModel: string | null;
  tools: ToolName[];
  /** Guion de las primeras respuestas. Null = apagado o sin pasos (ver first-replies.ts). */
  firstReplies: FirstRepliesConfig | null;
  /** Segundos de espera, desde el último mensaje de la persona, antes de contestar (0 a 60). */
  replyDelaySeconds: number;
};

// Espera antes de responder: varios mensajes seguidos reciben UNA respuesta. El tope evita que un valor
// absurdo deje a la persona esperando un minuto y medio.
export const DEFAULT_REPLY_DELAY_SECONDS = 5;
export const MAX_REPLY_DELAY_SECONDS = 60;

/** Valor válido o null. El 0 es válido (responder enseguida) y no se confunde con "vacío". */
export function parseReplyDelay(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim().replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_REPLY_DELAY_SECONDS, Math.max(0, Math.round(n)));
}

type Row = typeof agentConfigs.$inferSelect;

// Cascada: config del canal -> config global -> default del código. `enabled` es solo del canal.
export function mergeAgentConfig(channelRow: Row | undefined, globalRow: Row | undefined): ResolvedAgentConfig {
  const pick = <K extends "systemPrompt" | "model" | "decisionModel" | "enabledTools" | "firstReplies" | "replyDelaySeconds">(key: K) => {
    const v = channelRow?.[key];
    const hasValue = Array.isArray(v) ? true : typeof v === "string" ? v.trim() !== "" : v != null;
    return hasValue ? v : globalRow?.[key];
  };
  const tools = (pick("enabledTools") as string[] | null | undefined) ?? [...TOOL_NAMES];
  return {
    enabled: channelRow?.enabled ?? false,
    systemPrompt: (pick("systemPrompt") as string | null | undefined)?.trim() || DEFAULT_SYSTEM_PROMPT,
    model: (pick("model") as string | null | undefined)?.trim() || DEFAULT_MODEL(),
    decisionModel: (pick("decisionModel") as string | null | undefined)?.trim() || null,
    tools: tools.filter((t): t is ToolName => (TOOL_NAMES as readonly string[]).includes(t)),
    // Si el canal tiene su propio guion (aunque esté apagado) manda sobre el general: apagarlo acá lo apaga.
    firstReplies: activeFirstReplies(pick("firstReplies")),
    replyDelaySeconds: parseReplyDelay(pick("replyDelaySeconds")) ?? DEFAULT_REPLY_DELAY_SECONDS,
  };
}

export async function resolveAgentConfig(orgId: string, channel: Channel): Promise<ResolvedAgentConfig> {
  const rows = await getDb()
    .select()
    .from(agentConfigs)
    .where(and(eq(agentConfigs.organizationId, orgId), inArray(agentConfigs.scope, [channel, "global"])));
  return mergeAgentConfig(
    rows.find((r) => r.scope === channel),
    rows.find((r) => r.scope === "global"),
  );
}

/**
 * Espera antes de que el agente conteste, para el canal de esta conversación. Se llama desde la ingesta, dentro de la
 * misma transacción que guarda el mensaje. Si la lectura falla, la espera por defecto: nunca rompe la ingesta. La lectura va en
 * un savepoint: un error de SQL dentro de una transacción la deja abortada, y eso perdería el mensaje.
 */
export async function resolveReplyDelayMs(orgId: string, channel: Channel, db: DbExecutor = getDb()): Promise<number> {
  try {
    const rows = await db.transaction((sp) =>
      sp
        .select({ scope: agentConfigs.scope, value: agentConfigs.replyDelaySeconds })
        .from(agentConfigs)
        .where(and(eq(agentConfigs.organizationId, orgId), inArray(agentConfigs.scope, [channel, "global"]))),
    );
    const own = parseReplyDelay(rows.find((r) => r.scope === channel)?.value);
    const global = parseReplyDelay(rows.find((r) => r.scope === "global")?.value);
    return (own ?? global ?? DEFAULT_REPLY_DELAY_SECONDS) * 1000;
  } catch {
    return DEFAULT_REPLY_DELAY_SECONDS * 1000;
  }
}
