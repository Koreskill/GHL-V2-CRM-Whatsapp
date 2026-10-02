import Link from "next/link";
import { MessageCircle, Search } from "lucide-react";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { EmptyState } from "@/components/ui/primitives";
import { formatListDate } from "@/lib/format";
import type { ConversationListItem } from "@/lib/inbox/queries";
import { cn } from "@/lib/utils";
import type { InboxTab } from "@/lib/inbox/status";
import type { OpenDelegation } from "@/lib/delegations/flow";
import { Avatar } from "./avatar";
import { DelegationList } from "./delegation-list";
import { InboxAutoRefresh } from "./inbox-auto-refresh";

const CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook"];

export type InboxFilters = { channel?: Channel; q?: string; tab?: InboxTab };

export type InboxCounts = { desactivas: number; activas: number; delegadas: number; archivadas: number };

export function inboxHref(path: string, f: InboxFilters) {
  const params = new URLSearchParams();
  if (f.channel) params.set("channel", f.channel);
  if (f.q) params.set("q", f.q);
  if (f.tab && f.tab !== "activas") params.set("tab", f.tab);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export function ConversationList({
  items,
  counts,
  delegations,
  filters,
  activeId,
}: {
  items: ConversationListItem[];
  counts: InboxCounts;
  delegations: OpenDelegation[];
  filters: InboxFilters;
  activeId?: string;
}) {
  const filtered = Boolean(filters.channel || filters.q);
  const tab: InboxTab = filters.tab ?? "activas";

  return (
    <section className="flex w-[360px] shrink-0 flex-col border-r border-line bg-card">
      <InboxAutoRefresh />
      <div className="border-b border-line p-5">
        <div className="flex items-center gap-2">
          <h1 className="text-[18px] font-semibold text-ink">Conversaciones</h1>
        </div>

        <div role="tablist" aria-label="Estado" className="mt-3 flex gap-1 rounded-xl bg-field p-0.5">
          {([
            ["desactivas", "Desactivas"],
            ["activas", "Activas"],
            ["archivadas", "Archivadas"],
            ["delegadas", "Delegadas"],
          ] as const).map(([id, label]) => (
            <Link
              key={id}
              role="tab"
              aria-selected={tab === id}
              href={inboxHref("/conversaciones", { channel: filters.channel, q: filters.q, tab: id })}
              className={cn(
                "flex h-8 flex-1 items-center justify-center gap-1 rounded-lg px-1 text-[12px] font-medium transition-colors",
                tab === id ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              {label}
              <span className={cn("rounded-md px-1 text-[11px]", id === "delegadas" && counts.delegadas > 0 ? "bg-primary text-white" : "bg-line/60 text-muted")}>{counts[id]}</span>
            </Link>
          ))}
        </div>

        <form action="/conversaciones" className="mt-4">
          <input type="hidden" name="tab" value={tab} />
          {filters.channel && <input type="hidden" name="channel" value={filters.channel} />}
          <label className="flex h-9 items-center gap-2 rounded-lg bg-field px-3 text-muted">
            <Search className="size-4" strokeWidth={1.8} />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Buscar por nombre, usuario o teléfono"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
            />
          </label>
        </form>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Chip href={inboxHref("/conversaciones", { q: filters.q, tab })} active={!filters.channel}>
            Todos
          </Chip>
          {CHANNELS.map((c) => {
            const { label, Icon, color } = CHANNEL_META[c];
            const active = filters.channel === c;
            return (
              <Chip key={c} href={inboxHref("/conversaciones", { channel: c, q: filters.q, tab })} active={active}>
                <Icon className={cn("size-3.5", active ? "text-white" : color)} />
                {label}
              </Chip>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "delegadas" ? (
          <DelegationList items={delegations} />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState icon={Search} title="Sin resultados" description="Ninguna conversación coincide con el filtro." />
          ) : (
            <EmptyState
              icon={MessageCircle}
              title={tab === "desactivas" ? "Sin conversaciones desactivadas" : tab === "archivadas" ? "Sin conversaciones archivadas" : "Aun no hay conversaciones."}
              description={tab === "activas" ? "Cuando alguien te escriba por WhatsApp, Instagram o Messenger, va a aparecer acá." : "Acá aparecen las que muevas a este estado."}
            />
          )
        ) : (
          <ul>
            {items.map((c) => (
              <li key={c.id}>
                <Link
                  href={inboxHref(`/conversaciones/${c.id}`, filters)}
                  className={cn(
                    "flex gap-3 border-b border-line/70 px-5 py-3.5 transition-colors",
                    c.id === activeId ? "bg-field" : "hover:bg-field/60",
                  )}
                >
                  <Avatar name={c.name} picture={c.picture} channel={c.channel} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn("truncate text-[13.5px] text-ink", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>
                        {c.name}
                      </span>
                      <span className="ml-auto shrink-0 text-[11.5px] text-muted">{formatListDate(c.lastMessageAt)}</span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <span className={cn("truncate text-[12.5px]", c.unreadCount > 0 ? "text-ink" : "text-muted")}>
                        {c.previewDirection === "outbound" && "Tú: "}
                        {c.preview ?? (c.channel === "whatsapp" ? c.phone : c.handle && `@${c.handle}`) ?? ""}
                      </span>
                      {c.unreadCount > 0 && (
                        <span className="ml-auto grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-primary px-1 text-[10.5px] font-semibold text-white">
                          {c.unreadCount > 99 ? "99+" : c.unreadCount}
                        </span>
                      )}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
        active ? "bg-primary text-white" : "bg-field text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
