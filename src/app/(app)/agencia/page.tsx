import Link from "next/link";
import { redirect } from "next/navigation";
import { Bot, Building2, MessageCircle, Plus, Users } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { listClientsOverview } from "@/lib/agency/queries";
import { countUsersByOrg } from "@/lib/agency/users";
import { requireAgencyAdmin } from "@/lib/auth";
import { formatListDate } from "@/lib/format";
import { hasAdminKey } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

export const metadata = { title: "Agencia · Setter CRM" };

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">{label}</p>
      <p className={cn("mt-0.5 text-[19px] font-bold tabular-nums text-ink", tone)}>{value}</p>
    </div>
  );
}

export default async function AgenciaPage() {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");

  const clients = await listClientsOverview();
  // Los usuarios viven en Supabase Auth: sin la clave de servicio se muestra el resto igual.
  const userCounts = hasAdminKey() ? await countUsersByOrg().catch(() => ({}) as Record<string, number>) : {};

  const totals = clients.reduce(
    (acc, c) => ({
      conversations: acc.conversations + c.conversations,
      inbound: acc.inbound + c.inbound7d,
      agent: acc.agent + c.agentReplies7d,
      cost: acc.cost + c.aiCostUsd30d,
    }),
    { conversations: 0, inbound: 0, agent: 0, cost: 0 },
  );

  return (
    <>
      <PageHeader
        title="Agencia"
        subtitle="Cómo viene cada cliente: conversaciones, respuestas del agente y uso de IA"
        actions={
          <Link href="/agencia/nuevo">
            <Button>
              <Plus className="size-4" strokeWidth={2} />
              Nuevo cliente
            </Button>
          </Link>
        }
      />

      {!hasAdminKey() && (
        <Card className="mb-5 border-accent-amber/40 bg-accent-amber/5 p-4">
          <p className="text-[13.5px] text-ink">
            Falta <code className="rounded bg-field px-1 py-0.5 text-[12.5px]">SUPABASE_SECRET_KEY</code> en las
            variables del servidor. Sin esa clave se pueden ver los clientes, pero no crear usuarios ni cambiar
            contraseñas.
          </p>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Clientes", value: clients.length, icon: Building2 },
          { label: "Conversaciones", value: totals.conversations, icon: MessageCircle },
          { label: "Entrantes · 7 días", value: totals.inbound, icon: MessageCircle },
          { label: "Respuestas del agente · 7 días", value: totals.agent, icon: Bot },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <div className="flex items-start justify-between">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">{m.label}</p>
              <m.icon className="size-4 text-muted" strokeWidth={1.6} />
            </div>
            <p className="mt-2 text-[27px] leading-none font-bold tabular-nums text-ink">{m.value}</p>
          </Card>
        ))}
      </div>

      {clients.length === 0 ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="Todavía no hay clientes"
            description="Crea la primera inmobiliaria y su usuario administrador para empezar."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {clients.map((c) => (
            <Link key={c.id} href={`/agencia/${c.id}`} className="block">
              <Card className="p-5 transition-colors hover:border-primary/40">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <h2 className="truncate text-[17px] font-semibold text-ink">{c.name}</h2>
                      <span
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[11.5px] font-medium",
                          c.status === "activa" ? "bg-accent-green/12 text-accent-green" : "bg-field text-muted",
                        )}
                      >
                        {c.status}
                      </span>
                      {c.agentChannelsOn > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary">
                          <Bot className="size-3" strokeWidth={1.8} />
                          Agente en {c.agentChannelsOn} canal{c.agentChannelsOn > 1 ? "es" : ""}
                        </span>
                      ) : (
                        <span className="rounded-md bg-field px-2 py-0.5 text-[11.5px] font-medium text-muted">
                          Agente apagado
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[12.5px] text-muted">
                      {c.slug} · {c.accounts} cuenta{c.accounts === 1 ? "" : "s"} conectada
                      {c.accounts === 1 ? "" : "s"}
                      {userCounts[c.id] !== undefined && (
                        <>
                          {" · "}
                          <Users className="mb-0.5 inline size-3" strokeWidth={1.7} /> {userCounts[c.id]} usuario
                          {userCounts[c.id] === 1 ? "" : "s"}
                        </>
                      )}
                      {" · última actividad "}
                      {c.lastMessageAt ? formatListDate(c.lastMessageAt) : "nunca"}
                    </p>
                  </div>

                  <div className="flex shrink-0 gap-7">
                    <Metric label="Contactos" value={c.contacts} />
                    <Metric label="Conversaciones" value={c.conversations} />
                    <Metric label="Entrantes 7d" value={c.inbound7d} />
                    <Metric label="Agente 7d" value={c.agentReplies7d} />
                    <Metric
                      label="IA 30d"
                      value={c.aiCostUsd30d > 0 ? `US$ ${c.aiCostUsd30d.toFixed(2)}` : `${c.aiCalls30d}`}
                      tone={c.aiErrors30d > 0 ? "text-accent-amber" : undefined}
                    />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
