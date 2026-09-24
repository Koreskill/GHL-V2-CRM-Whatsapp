import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Bot, Eye, User } from "lucide-react";
import { CHANNEL_META } from "@/components/channel-icons";
import { Card, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/api";
import { getOrganization, writeAudit } from "@/lib/agency/queries";
import { requireAgencyAdmin } from "@/lib/auth";
import { dayOf, formatDayDivider, formatTime } from "@/lib/format";
import { getConversation, listMessages } from "@/lib/inbox/queries";
import { cn } from "@/lib/utils";

// Transcripción de solo lectura: desde el plano de agencia se MIRA cómo viene contestando el
// agente, no se responde. Todo envío sigue saliendo por el CRM del cliente (deliverMessage).
export default async function AgenciaConversacionPage({
  params,
}: PageProps<"/agencia/[orgId]/conversaciones/[conversationId]">) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");

  const { orgId, conversationId } = await params;
  if (!isUuid(orgId) || !isUuid(conversationId)) notFound();

  const [org, conversation] = await Promise.all([getOrganization(orgId), getConversation(conversationId, orgId)]);
  if (!org || !conversation) notFound();

  const messages = await listMessages(conversationId, orgId, 300);

  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "agency_view_conversation",
    target: `conversation:${conversationId}`,
  });

  const meta = CHANNEL_META[conversation.channel];
  // El separador de día se calcula antes de renderizar: dentro del map no se puede ir acumulando estado.
  const rows = messages.map((m, i) => ({
    message: m,
    divider: i === 0 || dayOf(m.sentAt) !== dayOf(messages[i - 1].sentAt) ? formatDayDivider(m.sentAt) : null,
  }));

  return (
    <>
      <PageHeader
        title={conversation.name}
        subtitle={`${org.name} · ${meta.label}`}
        actions={
          <Link
            href={`/agencia/${orgId}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <ArrowLeft className="size-4" strokeWidth={1.7} />
            Volver al cliente
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-field px-2.5 py-1 text-[12.5px] font-medium text-muted">
          <Eye className="size-3.5" strokeWidth={1.7} />
          Solo lectura
        </span>
        <span
          className={cn(
            "rounded-md px-2.5 py-1 text-[12.5px] font-medium",
            conversation.aiEnabled ? "bg-primary/10 text-primary" : "bg-field text-muted",
          )}
        >
          IA {conversation.aiEnabled ? "activa" : "pausada"} en esta conversación
        </span>
        <span className="rounded-md bg-field px-2.5 py-1 text-[12.5px] font-medium text-muted">
          Ventana: {conversation.window.state}
        </span>
      </div>

      <Card className="max-w-3xl p-5">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-[13.5px] text-muted">Esta conversación no tiene mensajes.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map(({ message: m, divider }) => {
              const out = m.direction === "outbound";
              return (
                <div key={m.id}>
                  {divider && (
                    <p className="my-4 text-center text-[11.5px] font-medium tracking-wide text-muted">{divider}</p>
                  )}
                  <div className={cn("flex", out ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[78%] rounded-2xl px-3.5 py-2.5",
                        out ? "bg-primary text-white" : "border border-line bg-field text-ink",
                      )}
                    >
                      <p className="text-[14px] leading-relaxed whitespace-pre-wrap">
                        {m.body ?? <span className="opacity-70">[{m.type}]</span>}
                      </p>
                      <p
                        className={cn(
                          "mt-1 flex items-center gap-1 text-[11px]",
                          out ? "justify-end text-white/70" : "text-muted",
                        )}
                      >
                        {out &&
                          (m.source === "agent" ? (
                            <>
                              <Bot className="size-3" strokeWidth={1.8} /> Agente
                            </>
                          ) : (
                            <>
                              <User className="size-3" strokeWidth={1.8} /> Persona
                            </>
                          ))}
                        {formatTime(m.sentAt)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
