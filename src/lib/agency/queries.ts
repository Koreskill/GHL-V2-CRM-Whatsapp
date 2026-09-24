import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { agentConfigs, aiUsageLogs, auditLogs, organizations } from "@/db/schema";
import type { Session } from "@/lib/auth";

// Registro de auditoría del plano de control. Todo cambio de contexto o acción sensible del
// admin de la agencia queda acá.
export async function writeAudit(input: {
  actorUserId: string;
  actingAsOrganizationId?: string | null;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown>;
}) {
  await getDb()
    .insert(auditLogs)
    .values({
      actorUserId: input.actorUserId,
      actingAsOrganizationId: input.actingAsOrganizationId ?? null,
      action: input.action,
      target: input.target ?? null,
      metadata: input.metadata ?? {},
    })
    .catch(() => {});
}

// Resuelve sobre qué inmobiliaria actúa una request. Un usuario normal solo puede sobre la suya.
// El admin de la agencia puede pasar un orgId explícito (cambio de contexto), que queda auditado.
export async function resolveActiveOrg(session: Session, requestedOrgId?: string | null): Promise<string | null> {
  if (!requestedOrgId || requestedOrgId === session.organizationId) return session.organizationId;
  if (!session.isAgencyAdmin) return null;
  // El admin de la agencia entra a otra inmobiliaria: se registra el cambio de contexto.
  await writeAudit({
    actorUserId: session.user.id,
    actingAsOrganizationId: requestedOrgId,
    action: "context_switch",
    target: `organization:${requestedOrgId}`,
  });
  return requestedOrgId;
}

// Catálogo de inmobiliarias. Solo para el admin de la agencia (el llamador valida el permiso).
export async function listOrganizations() {
  return getDb()
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status })
    .from(organizations)
    .orderBy(organizations.name);
}

export async function listAuditLogs(limit = 100) {
  return getDb().select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
}

// Vista cross-tenant de una inmobiliaria puntual (solo agencia).
export async function getOrganization(orgId: string) {
  const [row] = await getDb().select().from(organizations).where(eq(organizations.id, orgId));
  return row ?? null;
}

// ─── Visión de agencia ──────────────────────────────────────────────────────
// Todo lo de acá cruza tenants a propósito: es el panel del dueño del CRM. Cada llamador
// valida `isAgencyAdmin` ANTES de invocarlo. Son métricas y actividad, no datos de contacto.

export type ClientOverview = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  contacts: number;
  conversations: number;
  unread: number;
  inbound7d: number;
  outbound7d: number;
  agentReplies7d: number;
  agentChannelsOn: number;
  accounts: number;
  lastMessageAt: string | null;
  aiCalls30d: number;
  aiErrors30d: number;
  aiCostUsd30d: number;
  openDeals: number;
  upcomingVisits: number;
  activeProperties: number;
  lastSyncAt: string | null;
  syncStatus: string | null;
  openIncidents: number;
};

// Las filas de SQL crudo pueden traer timestamptz como string, aunque las consultas
// tipadas de Drizzle lo conviertan a Date. Aceptamos ambas formas al serializar.
const toIso = (value: string | Date) => new Date(value).toISOString();

export async function listClientsOverview(): Promise<ClientOverview[]> {
  const rows = await getDb().execute<{
    id: string;
    name: string;
    slug: string;
    status: string;
    created_at: string | Date;
    contacts: number;
    conversations: number;
    unread: number;
    inbound_7d: number;
    outbound_7d: number;
    agent_replies_7d: number;
    agent_channels_on: number;
    accounts: number;
    last_message_at: string | Date | null;
    ai_calls_30d: number;
    ai_errors_30d: number;
    ai_cost_30d: string | null;
    open_deals: number;
    upcoming_visits: number;
    active_properties: number;
    last_sync_at: string | Date | null;
    sync_status: string | null;
    open_incidents: number;
  }>(sql`
    select
      o.id, o.name, o.slug, o.status, o.created_at,
      (select count(*)::int from contacts c where c.organization_id = o.id) as contacts,
      (select count(*)::int from conversations v where v.organization_id = o.id) as conversations,
      (select coalesce(sum(unread_count),0)::int from conversations v where v.organization_id = o.id) as unread,
      (select count(*)::int from messages m where m.organization_id = o.id
         and m.direction = 'inbound' and m.sent_at >= now() - interval '7 days') as inbound_7d,
      (select count(*)::int from messages m where m.organization_id = o.id
         and m.direction = 'outbound' and m.status <> 'failed' and m.sent_at >= now() - interval '7 days') as outbound_7d,
      (select count(*)::int from messages m where m.organization_id = o.id
         and m.direction = 'outbound' and m.status <> 'failed' and m.raw_payload->>'source' = 'agent'
         and m.sent_at >= now() - interval '7 days') as agent_replies_7d,
      (select count(*)::int from agent_configs a where a.organization_id = o.id
         and a.scope <> 'global' and a.enabled) as agent_channels_on,
      (select count(*)::int from channel_accounts k where k.organization_id = o.id) as accounts,
      (select max(v.last_message_at) from conversations v where v.organization_id = o.id) as last_message_at,
      (select count(*)::int from ai_usage_logs l where l.organization_id = o.id
         and l.created_at >= now() - interval '30 days') as ai_calls_30d,
      (select count(*)::int from ai_usage_logs l where l.organization_id = o.id
         and l.status <> 'ok' and l.created_at >= now() - interval '30 days') as ai_errors_30d,
      (select coalesce(sum(l.cost_usd), 0) from ai_usage_logs l where l.organization_id = o.id
         and l.created_at >= now() - interval '30 days') as ai_cost_30d,
      (select count(*)::int from deals d where d.organization_id = o.id and d.status = 'abierta') as open_deals,
      (select count(*)::int from visits v where v.organization_id = o.id and v.status = 'agendada'
         and v.scheduled_at between now() and now() + interval '7 days') as upcoming_visits,
      (select count(*)::int from properties p where p.organization_id = o.id and p.status = 'disponible') as active_properties,
      (select last_run_at from property_sync_configs s where s.organization_id = o.id) as last_sync_at,
      (select last_status from property_sync_configs s where s.organization_id = o.id) as sync_status,
      (select count(*)::int from incidents i where i.organization_id = o.id and i.status <> 'resuelto') as open_incidents
    from organizations o
    order by o.name
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    status: r.status,
    createdAt: toIso(r.created_at),
    contacts: r.contacts,
    conversations: r.conversations,
    unread: r.unread,
    inbound7d: r.inbound_7d,
    outbound7d: r.outbound_7d,
    agentReplies7d: r.agent_replies_7d,
    agentChannelsOn: r.agent_channels_on,
    accounts: r.accounts,
    lastMessageAt: r.last_message_at ? toIso(r.last_message_at) : null,
    aiCalls30d: r.ai_calls_30d,
    aiErrors30d: r.ai_errors_30d,
    aiCostUsd30d: Number(r.ai_cost_30d ?? 0),
    openDeals: r.open_deals,
    upcomingVisits: r.upcoming_visits,
    activeProperties: r.active_properties,
    lastSyncAt: r.last_sync_at ? toIso(r.last_sync_at) : null,
    syncStatus: r.sync_status,
    openIncidents: r.open_incidents,
  }));
}

// Estado del agente por canal de un cliente: lo que mira el dueño para saber si "está contestando".
export type ClientAgentChannel = { scope: string; enabled: boolean; model: string | null; hasPrompt: boolean };

export async function getClientAgentState(orgId: string): Promise<ClientAgentChannel[]> {
  const rows = await getDb()
    .select({
      scope: agentConfigs.scope,
      enabled: agentConfigs.enabled,
      model: agentConfigs.model,
      systemPrompt: agentConfigs.systemPrompt,
    })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, orgId));
  return rows.map((r) => ({
    scope: r.scope,
    enabled: r.enabled,
    model: r.model,
    hasPrompt: Boolean(r.systemPrompt?.trim()),
  }));
}

// Últimas llamadas a la IA. Sin texto del modelo ni del cliente: función, modelo, estado y costo.
export type AiActivityRow = {
  id: string;
  function: string;
  model: string;
  status: string;
  totalTokens: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
};

export async function listAiActivity(orgId: string, limit = 25): Promise<AiActivityRow[]> {
  const rows = await getDb()
    .select({
      id: aiUsageLogs.id,
      function: aiUsageLogs.function,
      model: aiUsageLogs.model,
      status: aiUsageLogs.status,
      totalTokens: aiUsageLogs.totalTokens,
      costUsd: aiUsageLogs.costUsd,
      latencyMs: aiUsageLogs.latencyMs,
      error: aiUsageLogs.error,
      createdAt: aiUsageLogs.createdAt,
    })
    .from(aiUsageLogs)
    .where(eq(aiUsageLogs.organizationId, orgId))
    .orderBy(desc(aiUsageLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    costUsd: r.costUsd === null ? null : Number(r.costUsd),
    createdAt: r.createdAt.toISOString(),
  }));
}

// Alta de cliente: la organización. El usuario administrador se crea aparte (agency/users.ts),
// porque vive en Supabase Auth y necesita la clave de servicio.
export async function createOrganization(input: { name: string; slug: string }) {
  const [row] = await getDb()
    .insert(organizations)
    .values({ name: input.name, slug: input.slug })
    .returning({ id: organizations.id, name: organizations.name, slug: organizations.slug });
  return row;
}

export async function slugTaken(slug: string) {
  const [row] = await getDb().select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, slug));
  return Boolean(row);
}
