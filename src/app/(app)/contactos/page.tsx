import Link from "next/link";
import { MessageCircle, Search, Users } from "lucide-react";
import { ChannelBadge } from "@/components/channel-badge";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { parseInboxFilters } from "@/components/inbox/filters";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireOrgId } from "@/lib/auth";
import { countContacts, listContacts } from "@/lib/crm/queries";
import { formatListDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook"];

function href(f: { channel?: Channel; q?: string }) {
  const p = new URLSearchParams();
  if (f.channel) p.set("channel", f.channel);
  if (f.q) p.set("q", f.q);
  const qs = p.toString();
  return qs ? `/contactos?${qs}` : "/contactos";
}

export default async function ContactosPage({ searchParams }: PageProps<"/contactos">) {
  const orgId = await requireOrgId();
  const filters = parseInboxFilters(await searchParams);
  const [contacts, total] = await Promise.all([listContacts(orgId, filters), countContacts(orgId)]);
  const filtered = Boolean(filters.channel || filters.q);

  return (
    <>
      <PageHeader title="Contactos" subtitle={`${total} ${total === 1 ? "persona" : "personas"} que escribieron por algún canal`} />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <form action="/contactos" className="w-full max-w-sm">
          {filters.channel && <input type="hidden" name="channel" value={filters.channel} />}
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-card px-3 text-muted">
            <Search className="size-4" strokeWidth={1.8} />
            <input
              type="search"
              name="q"
              defaultValue={filters.q ?? ""}
              placeholder="Buscar por nombre, usuario, teléfono o email"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
            />
          </label>
        </form>
        <div className="flex gap-1.5">
          <Chip href={href({ q: filters.q })} active={!filters.channel}>
            Todos
          </Chip>
          {CHANNELS.map((c) => {
            const { Icon, color, label } = CHANNEL_META[c];
            const active = filters.channel === c;
            return (
              <Chip key={c} href={href({ channel: c, q: filters.q })} active={active}>
                <Icon className={cn("size-3.5", active ? "text-white" : color)} /> {label}
              </Chip>
            );
          })}
        </div>
      </div>

      <Card className="overflow-hidden">
        {contacts.length === 0 ? (
          filtered ? (
            <EmptyState icon={Search} title="Sin resultados" description="Ningún contacto coincide con el filtro." className="py-20" />
          ) : (
            <EmptyState
              icon={Users}
              title="Todavía no hay contactos"
              description="Cada persona que escriba por WhatsApp, Instagram o Messenger se agrega acá automáticamente."
              className="py-20"
            />
          )
        ) : (
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] font-semibold tracking-wide text-muted uppercase">
                <th className="px-6 py-3 font-semibold">Contacto</th>
                <th className="px-4 py-3 font-semibold">Canales</th>
                <th className="px-4 py-3 font-semibold">Teléfono</th>
                <th className="px-4 py-3 font-semibold">Último mensaje</th>
                <th className="px-6 py-3 text-right font-semibold">Conversaciones</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-line/70 last:border-0 hover:bg-field/50">
                  <td className="px-6 py-3.5">
                    <span className="flex items-center gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-field text-[11.5px] font-semibold text-muted">
                        {initials(c.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{c.name}</span>
                        {c.email && <span className="block truncate text-[12px] text-muted">{c.email}</span>}
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="flex flex-wrap gap-1.5">
                      {c.handles.map((h) => (
                        <ChannelBadge
                          key={h.channel}
                          channel={h.channel}
                          text={h.channel === "whatsapp" ? "WhatsApp" : h.handle ? `@${h.handle}` : undefined}
                        />
                      ))}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-ink">{c.phone ?? <span className="text-muted">—</span>}</td>
                  <td className="px-4 py-3.5 text-muted">{c.lastMessageAt ? formatListDate(c.lastMessageAt) : "—"}</td>
                  <td className="px-6 py-3.5">
                    <span className="flex justify-end gap-1.5">
                      {c.conversations.map((cv) => {
                        const { Icon, color, label } = CHANNEL_META[cv.channel];
                        return (
                          <Link
                            key={cv.id}
                            href={`/conversaciones/${cv.id}`}
                            title={`Abrir conversación de ${label}`}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] text-ink hover:bg-field"
                          >
                            <Icon className={cn("size-3.5", color)} />
                            <MessageCircle className="size-3.5 text-muted" strokeWidth={1.7} />
                          </Link>
                        );
                      })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors",
        active ? "bg-primary text-white" : "border border-line bg-card text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
