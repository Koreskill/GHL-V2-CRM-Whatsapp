import type { Channel } from "@/db/schema";

const HOUR = 60 * 60 * 1000;
export const STANDARD_WINDOW_MS = 24 * HOUR;
export const HUMAN_AGENT_WINDOW_MS = 7 * 24 * HOUR;

// open: texto libre. human_agent: IG/FB con etiqueta HUMAN_AGENT (solo personas, no el agente IA).
// template_only: WhatsApp fuera de 24h. closed: IG/FB después de 7 días.
export type WindowState = "open" | "human_agent" | "template_only" | "closed";

export type MessagingWindow = {
  state: WindowState;
  expiresAt: string | null;
};

// La decide el servidor desde last_inbound_at; la UI solo la muestra.
export function computeWindow(channel: Channel, lastInboundAt: Date | null, now = Date.now()): MessagingWindow {
  if (!lastInboundAt) {
    return { state: channel === "whatsapp" ? "template_only" : "closed", expiresAt: null };
  }
  const since = now - lastInboundAt.getTime();
  const at = (ms: number) => new Date(lastInboundAt.getTime() + ms).toISOString();

  if (since < STANDARD_WINDOW_MS) return { state: "open", expiresAt: at(STANDARD_WINDOW_MS) };
  if (channel === "whatsapp") return { state: "template_only", expiresAt: null };
  if (since < HUMAN_AGENT_WINDOW_MS) return { state: "human_agent", expiresAt: at(HUMAN_AGENT_WINDOW_MS) };
  return { state: "closed", expiresAt: null };
}
