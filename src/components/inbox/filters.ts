import type { Channel } from "@/components/channel-icons";
import { INBOX_TABS, type InboxTab } from "@/lib/inbox/status";
import type { InboxFilters } from "./conversation-list";

const CHANNELS = new Set<string>(["whatsapp", "instagram", "facebook"]);

export function parseInboxFilters(params: Record<string, string | string[] | undefined>): InboxFilters {
  const channel = typeof params.channel === "string" && CHANNELS.has(params.channel) ? (params.channel as Channel) : undefined;
  const q = typeof params.q === "string" && params.q.trim() ? params.q.trim().slice(0, 100) : undefined;
  // Sin pestaña explícita se muestran las activas.
  const tab: InboxTab = typeof params.tab === "string" && (INBOX_TABS as readonly string[]).includes(params.tab) ? (params.tab as InboxTab) : "activas";
  return { channel, q, tab };
}
