import Link from "next/link";
import { Activity, AlertCircle, Bot, MessageCircle, Send, UserPlus, Users, Workflow, type LucideIcon } from "lucide-react";
import { ChannelBadge } from "@/components/channel-badge";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireOrgId } from "@/lib/auth";
import { getDashboard, listActivity, type ActivityKind } from "@/lib/crm/queries";
import { formatListDate } from "@/lib/format";
import { PIPELINE_STAGES } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

const fmt = (n: number) => n.toLocaleString("es-AR");

const ACTIVITY: Record<ActivityKind, { icon: LucideIcon; tone: string; label: (w: string) => string }> = {
  new_conversation: { icon: UserPlus, tone: "bg-accent-cyan/10 text-accent-cyan", label: (w) => `Nueva conversación con ${w}` },
  inbound: { icon: MessageCircle, tone: "bg-accent-blue/10 text-accent-blue", label: (w) => `${w} escribió` },
  agent: { icon: Bot, tone: "bg-accent-purple/10 text-accent-purple", label: (w) => `El agente respondió a ${w}` },
  human: { icon: Send, tone: "bg-accent-green/10 text-accent-green", label: (w) => `Se respondió a ${w}` },
  failed: { icon: AlertCircle, tone: "bg-accent-red/10 text-accent-red", label: (w) => `Falló un envío a ${w}` },
};

export default async function DashboardPage() {
  const orgId = await requireOrgId();
  const [d, activity] = await Promise.all([getDashboard(orgId), listActivity(orgId, 6)]);

  const metrics = [
    { label: "Total Contactos", value: fmt(d.contacts), hint: `${fmt(d.contacts_week)} nuevos esta semana`, icon: Users, tone: "text-accent-cyan" },
    { label: "Conversaciones activas", value: fmt(d.active), hint: "con mensajes en los últimos 7 días", icon: MessageCircle, tone: "text-accent-purple" },
    {
      label: "Mensajes sin leer",
      value: fmt(d.unread),
      hint: d.unread_conversations ? `en ${fmt(d.unread_conversations)} ${d.unread_conversations === 1 ? "conversación" : "conversaciones"}` : "bandeja al día",
      icon: Workflow,
      tone: "text-accent-green",
    },
    {
      label: "Respuestas del agente IA",
      value: fmt(d.agent),
      hint: d.replies ? `${Math.round((d.agent / d.replies) * 100)}% de las respuestas en 30 días` : "sin respuestas en 30 días",
      icon: Bot,
      tone: "text-accent-amber",
    },
  ];

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Resumen de tu pipeline de ventas" />

      <div className="grid grid-cols-4 gap-5">
        {metrics.map(({ label, value, hint, icon: Icon, tone }) => (
          <Card key={label} className="relative overflow-hidden p-5">
            <p className="text-[13px] font-medium text-muted">{label}</p>
            <p className="mt-2 text-[30px] leading-none font-bold text-ink">{value}</p>
            <p className="mt-3 text-[12px] text-muted">{hint}</p>
            <Icon className={`absolute top-5 right-5 size-9 opacity-25 ${tone}`} strokeWidth={1.3} />
          </Card>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-5">
        <Card className="col-span-2 p-6">
          <h2 className="text-[17px] font-semibold text-ink">Pipeline de Ventas</h2>
          <p className="text-[13px] text-muted">Distribución de deals por etapa</p>
          <div className="mt-6 grid grid-cols-5 gap-3">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage.id} className="rounded-xl border border-line p-3">
                <p className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                  <span className={`size-2 rounded-full ${stage.dot}`} /> {stage.label}
                </p>
                <p className="mt-2 text-[20px] font-bold text-ink">0</p>
                <p className="text-[11.5px] text-muted">$0.00</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[12.5px] text-muted">
            Todavía no hay deals cargados. <Link href="/pipeline" className="font-medium text-primary hover:underline">Ver pipeline</Link>
          </p>
        </Card>

        <Card className="p-6">
          <h2 className="text-[17px] font-semibold text-ink">Actividad Reciente</h2>
          <p className="text-[13px] text-muted">Últimos eventos del equipo</p>
          {activity.length === 0 ? (
            <EmptyState icon={Activity} title="Sin actividad todavía" description="Los eventos del equipo aparecerán acá." />
          ) : (
            <ul className="mt-4 flex flex-col gap-1">
              {activity.map((a) => {
                const k = ACTIVITY[a.kind];
                const Icon = k.icon;
                return (
                  <li key={a.id}>
                    <Link href={`/conversaciones/${a.conversationId}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-field/60">
                      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", k.tone)}>
                        <Icon className="size-4" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{k.label(a.who)}</span>
                        <span className="flex items-center gap-2 text-[11.5px] text-muted">
                          <ChannelBadge channel={a.channel} className="bg-transparent px-0 py-0" />
                          {formatListDate(a.at)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <Link href="/actividades" className="mt-3 inline-block text-[12.5px] font-medium text-primary hover:underline">
            Ver todas
          </Link>
        </Card>
      </div>
    </>
  );
}
