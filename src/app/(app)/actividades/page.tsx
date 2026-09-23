import Link from "next/link";
import { Activity, AlertCircle, Bot, MessageCircle, Send, UserPlus, type LucideIcon } from "lucide-react";
import { ChannelBadge } from "@/components/channel-badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listActivity, type ActivityKind } from "@/lib/crm/queries";
import { dayOf, formatDayDivider, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Actividades · Setter CRM" };

const KIND: Record<ActivityKind, { icon: LucideIcon; tone: string; label: (who: string) => string }> = {
  new_conversation: { icon: UserPlus, tone: "bg-accent-cyan/10 text-accent-cyan", label: (w) => `Nueva conversación con ${w}` },
  inbound: { icon: MessageCircle, tone: "bg-accent-blue/10 text-accent-blue", label: (w) => `${w} escribió` },
  agent: { icon: Bot, tone: "bg-accent-purple/10 text-accent-purple", label: (w) => `El agente IA respondió a ${w}` },
  human: { icon: Send, tone: "bg-accent-green/10 text-accent-green", label: (w) => `Se respondió a ${w}` },
  failed: { icon: AlertCircle, tone: "bg-accent-red/10 text-accent-red", label: (w) => `Falló un envío a ${w}` },
};

export default async function ActividadesPage() {
  const items = await listActivity();

  return (
    <>
      <PageHeader title="Actividades" subtitle="Lo último que pasó en las conversaciones de todos los canales" />

      <Card>
        {items.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Sin actividad todavía"
            description="Los mensajes recibidos, las respuestas del equipo y del agente IA aparecen acá."
            className="py-20"
          />
        ) : (
          <ol className="px-6 py-2">
            {items.map((item, i) => {
              const k = KIND[item.kind];
              const Icon = k.icon;
              const newDay = i === 0 || dayOf(items[i - 1].at) !== dayOf(item.at);
              return (
                <li key={item.id}>
                  {newDay && (
                    <p className={cn("pb-2 text-[11px] font-semibold tracking-[0.1em] text-muted uppercase", i === 0 ? "pt-3" : "pt-6")}>
                      {formatDayDivider(item.at)}
                    </p>
                  )}
                  <Link
                    href={`/conversaciones/${item.conversationId}`}
                    className="-mx-3 flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-field/60"
                  >
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", k.tone)}>
                      <Icon className="size-4" strokeWidth={1.8} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium text-ink">{k.label(item.who)}</span>
                        <ChannelBadge channel={item.channel} className="py-0.5" />
                        <span className="ml-auto shrink-0 text-[12px] text-muted">{formatTime(item.at)}</span>
                      </span>
                      {(item.error ?? item.body) && (
                        <span className={cn("mt-0.5 block truncate text-[12.5px]", item.error ? "text-accent-red" : "text-muted")}>
                          {item.error ?? item.body}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </>
  );
}
