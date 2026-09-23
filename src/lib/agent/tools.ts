import { eq } from "drizzle-orm";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { getDb } from "@/db";
import { conversations } from "@/db/schema";

export const TOOL_NAMES = ["handoff_to_human"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_LABELS: Record<ToolName, { label: string; description: string }> = {
  handoff_to_human: {
    label: "Derivar a una persona",
    description: "Pausa la IA en la conversación para que un vendedor la tome.",
  },
};

export const TOOL_DEFINITIONS: Record<ToolName, ChatCompletionTool> = {
  handoff_to_human: {
    type: "function",
    function: {
      name: "handoff_to_human",
      description:
        "Deriva la conversación a un vendedor humano y pausa las respuestas automáticas. Usala cuando la persona pide hablar con alguien, está molesta, o el tema requiere a un asesor.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string", description: "Motivo breve de la derivación" } },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
};

export type ToolContext = { conversationId: string };

export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<{ output: string; handoff?: boolean }> {
  if (name === "handoff_to_human") {
    let reason = "";
    try {
      reason = String(JSON.parse(rawArgs || "{}").reason ?? "");
    } catch {}
    await getDb()
      .update(conversations)
      .set({ aiEnabled: false })
      .where(eq(conversations.id, ctx.conversationId));
    console.log(`[agent] handoff ${ctx.conversationId}: ${reason}`);
    return { output: "Conversación derivada a un vendedor. Despedite brevemente avisando que una persona continúa.", handoff: true };
  }
  return { output: `Herramienta desconocida: ${name}` };
}
