import type { Channel } from "@/components/channel-icons";
import type { InboxFilters } from "./conversation-list";

const CHANNELS = new Set<string>(["whatsapp", "instagram", "facebook"]);

export function parseInboxFilters(params: Record<string, string | string[] | undefined>): InboxFilters {
  const channel = typeof params.channel === "string" && CHANNELS.has(params.channel) ? (params.channel as Channel) : undefined;
  const q = typeof params.q === "string" && params.q.trim() ? params.q.trim().slice(0, 100) : undefined;
  return { channel, q };
}
