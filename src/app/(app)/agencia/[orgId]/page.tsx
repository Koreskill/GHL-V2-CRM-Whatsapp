import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Bot, KeyRound, MessageCircle, Users } from "lucide-react";
import { AgencyUsersPanel } from "@/components/agency/users-panel";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/api";
import { getClientAgentState, getOrganization, listAiActivity, writeAudit } from "@/lib/agency/queries";
import { listUsersByOrg } from "@/lib/agency/users";
import { requireAgencyAdmin } from "@/lib/auth";
import { getDashboard } from "@/lib/crm/queries";
import { formatListDate } from "@/lib/format";
import { listConversations } from "@/lib/inbox/queries";
import { hasAdminKey } from "@/lib/supabase/admin";
import { cn } from "@/lib/utils";

const CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook"];

const AVISOS: Record<string, string> = {
  creado: "Cliente creado. Pásale el email y la contraseña para que entre.",
  creado_usuario: "Usuario agregado.",
  clave: "Contraseña actualizada.",
  eliminado: "Usuario eliminado.",
};

export default async function ClienteAgenciaPage({ params, searchParams }: PageProps<"/agencia/[orgId]">) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");

  const { orgId } = await params;
  if (!isUuid(orgId)) notFound();
  const org = await getOrganization(orgId);
  if (!org) notFound();

  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 300) : null;
  const aviso =
    sp.creado === "1"
      ? AVISOS.creado
      : typeof sp.usuario === "string"
        ? (AVISOS[sp.usuario === "creado" ? "creado_usuario" : sp.usuario] ?? null)
        : null;

  // Entrar a la ficha de un cliente es mirar sus datos: queda registrado.
  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: orgId,
    action: "agency_view_client",
    target: `organization:${orgId}`,
  });

  const [stats, agentState, conversations, aiActivity] = await Promise.all([
    getDashboard(orgId),
    getClientAgentState(orgId),
    listConversations(orgId, { limit: 20 }),
    listAiActivity(orgId, 12),
  ]);
  const users = hasAdminKey() ? await listUsersByOrg(orgId).catch(() => []) : [];

  const globalCfg = agentState.find((a) => a.scope === "global");

  return (
    <>
      <PageHeader
        title={org.name}
        subtitle={`${org.slug} · cliente ${org.status}`}
        actions={
          <Link
            href="/agencia"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <ArrowLeft className="size-4" strokeWidth={1.7} />
            Clientes
          </Link>
        }
      />

      {aviso && (
        <p className="mb-5 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-accent-green">{aviso}</p>
      )}
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        {[
          { label: "Contactos", value: stats.contacts },
          { label: "Activas · 7d", value: stats.active },
          { label: "Respuestas · 30d", value: stats.replies },
          { label: "Del agente · 30d", value: stats.agent },
          { label: "Sin leer", value: stats.unread },
        ].map((m) => (
          <Card key={m.label} className="p-4">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">{m.label}</p>
            <p className="mt-2 text-[25px] leading-none font-bold tabular-nums text-ink">{m.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <MessageCircle className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Conversaciones</h2>
              <span className="text-[12.5px] text-muted">últimas {conversations.length}</span>
            </div>
            {conversations.length === 0 ? (
              <EmptyState
                icon={MessageCircle}
                title="Sin conversaciones"
                description="Este cliente todavía no recibió mensajes."
              />
            ) : (
              <ul className="divide-y divide-line">
                {conversations.map((c) => {
                  const meta = CHANNEL_META[c.channel];
                  return (
                    <li key={c.id}>
                      <Link
                        href={`/agencia/${orgId}/conversaciones/${c.id}`}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-field"
                      >
                        <meta.Icon className={cn("size-4 shrink-0", meta.color)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium text-ink">{c.name}</span>
                          <span className="block truncate text-[12.5px] text-muted">
                            {c.preview ?? "Sin mensajes"}
                          </span>
                        </span>
                        <span className="shrink-0 text-[12px] text-muted">
                          {c.lastMessageAt ? formatListDate(c.lastMessageAt) : "—"}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <Bot className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Últimas llamadas a la IA</h2>
            </div>
            {aiActivity.length === 0 ? (
              <EmptyState
                icon={Bot}
                title="El agente todavía no corrió"
                description="Cuando conteste un mensaje vas a ver acá cada llamada, con su modelo y su costo."
              />
            ) : (
              <ul className="divide-y divide-line">
                {aiActivity.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        a.status === "ok" ? "bg-accent-green" : "bg-accent-red",
                      )}
                    />
                    <span className="w-36 shrink-0 truncate font-medium text-ink">{a.function}</span>
                    <span className="min-w-0 flex-1 truncate text-muted">{a.model}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {a.totalTokens ? `${a.totalTokens} tok` : "—"}
                    </span>
                    <span className="w-24 shrink-0 text-right text-muted">{formatListDate(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Agente por canal</h2>
            </div>
            <ul className="mt-4 flex flex-col gap-2.5">
              {CHANNELS.map((ch) => {
                const meta = CHANNEL_META[ch];
                const cfg = agentState.find((a) => a.scope === ch);
                const on = Boolean(cfg?.enabled);
                return (
                  <li key={ch} className="flex items-center gap-2.5">
                    <meta.Icon className={cn("size-4 shrink-0", meta.color)} />
                    <span className="flex-1 text-[13.5px] text-ink">{meta.label}</span>
                    <span className="max-w-[110px] truncate text-[12px] text-muted">
                      {cfg?.model ?? globalCfg?.model ?? "modelo por defecto"}
                    </span>
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[11.5px] font-medium",
                        on ? "bg-accent-green/12 text-accent-green" : "bg-field text-muted",
                      )}
                    >
                      {on ? "Contesta" : "Apagado"}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 text-[12px] leading-relaxed text-muted">
              El agente solo contesta si el canal está prendido y la conversación tiene la IA activa. Esa
              configuración la cambia el administrador del cliente desde su Configuración.
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <Users className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Usuarios</h2>
            </div>
            {hasAdminKey() ? (
              <AgencyUsersPanel orgId={orgId} users={users} currentUserId={session.user.id} />
            ) : (
              <div className="px-5 py-5 text-[13px] text-muted">
                <KeyRound className="mb-2 size-4" strokeWidth={1.7} />
                Configura <code className="rounded bg-field px-1 py-0.5 text-[12.5px]">SUPABASE_SECRET_KEY</code> para
                administrar los usuarios de este cliente.
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
