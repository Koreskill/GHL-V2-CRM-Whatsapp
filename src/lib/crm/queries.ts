import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import type { Channel } from "@/db/schema";

const TZ = "America/Argentina/Buenos_Aires";

// ---------- Contactos ----------

export type ContactRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  handles: { channel: Channel; handle: string | null }[];
  conversations: { id: string; channel: Channel }[];
  lastMessageAt: string | null;
  createdAt: string;
};

export async function listContacts(filters: { q?: string; channel?: Channel; limit?: number }) {
  const q = filters.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;

  const rows = await getDb().execute<{
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    handles: { channel: Channel; handle: string | null }[] | null;
    conversations: { id: string; channel: Channel }[] | null;
    last_message_at: string | null;
    created_at: string;
    fallback_name: string | null;
  }>(sql`
    select c.id, c.name, c.phone, c.email, c.created_at,
      (select json_agg(json_build_object('channel', ci.channel, 'handle', ci.handle) order by ci.created_at)
         from contact_identities ci where ci.contact_id = c.id) as handles,
      (select json_agg(json_build_object('id', cv.id, 'channel', cv.channel) order by cv.last_message_at desc nulls last)
         from conversations cv where cv.contact_id = c.id) as conversations,
      (select max(cv.last_message_at) from conversations cv where cv.contact_id = c.id) as last_message_at,
      (select coalesce(cv.participant_name, cv.participant_handle) from conversations cv
         where cv.contact_id = c.id order by cv.last_message_at desc nulls last limit 1) as fallback_name
    from contacts c
    where (${like}::text is null
           or c.name ilike ${like} or c.phone ilike ${like} or c.email ilike ${like}
           or exists (select 1 from contact_identities ci where ci.contact_id = c.id and ci.handle ilike ${like})
           or exists (select 1 from conversations cv where cv.contact_id = c.id
                      and (cv.participant_name ilike ${like} or cv.participant_handle ilike ${like})))
      and (${filters.channel ?? null}::channel is null
           or exists (select 1 from contact_identities ci where ci.contact_id = c.id and ci.channel = ${filters.channel ?? null}::channel))
    order by last_message_at desc nulls last, c.created_at desc
    limit ${filters.limit ?? 200}
  `);

  return rows.map<ContactRow>((r) => {
    const handles = r.handles ?? [];
    return {
      id: r.id,
      name: r.name ?? r.fallback_name ?? handles.find((h) => h.handle)?.handle ?? r.phone ?? "Sin nombre",
      phone: r.phone,
      email: r.email,
      // Un canal por contacto en la vista: el mismo canal puede tener dos ids (BSUID y teléfono).
      handles: handles.filter((h, i) => handles.findIndex((x) => x.channel === h.channel) === i),
      conversations: r.conversations ?? [],
      lastMessageAt: r.last_message_at ? new Date(r.last_message_at).toISOString() : null,
      createdAt: new Date(r.created_at).toISOString(),
    };
  });
}

export async function countContacts() {
  const [row] = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from contacts`);
  return row.n;
}

// ---------- Actividades ----------

export type ActivityKind = "inbound" | "agent" | "human" | "failed" | "new_conversation";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  conversationId: string;
  channel: Channel;
  who: string;
  body: string | null;
  error: string | null;
  at: string;
};

export async function listActivity(limit = 80): Promise<ActivityItem[]> {
  const rows = await getDb().execute<{
    id: string;
    conversation_id: string;
    channel: Channel;
    direction: "inbound" | "outbound";
    status: string;
    body: string | null;
    type: string;
    error: string | null;
    source: string | null;
    sent_at: string;
    who: string | null;
    is_first: boolean;
  }>(sql`
    select m.id, m.conversation_id, m.channel, m.direction, m.status, m.body, m.type, m.error,
           m.raw_payload->>'source' as source, m.sent_at,
           coalesce(ct.name, cv.participant_name, cv.participant_handle, cv.participant_id) as who,
           not exists (select 1 from messages p where p.conversation_id = m.conversation_id and p.sent_at < m.sent_at) as is_first
    from messages m
    join conversations cv on cv.id = m.conversation_id
    left join contacts ct on ct.id = cv.contact_id
    order by m.sent_at desc
    limit ${limit}
  `);

  return rows.map((r) => {
    const kind: ActivityKind =
      r.status === "failed"
        ? "failed"
        : r.direction === "inbound"
          ? r.is_first
            ? "new_conversation"
            : "inbound"
          : r.source === "agent"
            ? "agent"
            : "human";
    return {
      id: r.id,
      kind,
      conversationId: r.conversation_id,
      channel: r.channel,
      who: r.who ?? "Sin nombre",
      body: r.body ?? (r.type !== "text" ? `[${r.type}]` : null),
      error: r.error,
      at: new Date(r.sent_at).toISOString(),
    };
  });
}

// ---------- Reportes ----------

export type ReportData = {
  days: number;
  newConversations: number;
  inbound: number;
  outbound: number;
  agentReplies: number;
  humanReplies: number;
  failed: number;
  unread: number;
  medianFirstResponseSec: number | null;
  byChannel: { channel: Channel; conversations: number; inbound: number }[];
  daily: { day: string; inbound: number }[];
};

export async function getReport(days: number): Promise<ReportData> {
  const db = getDb();
  const since = sql`now() - make_interval(days => ${days})`;

  const [totals] = await db.execute<{
    new_conversations: number;
    inbound: number;
    outbound: number;
    agent: number;
    human: number;
    failed: number;
    unread: number;
  }>(sql`
    select
      (select count(*)::int from conversations where created_at >= ${since}) as new_conversations,
      (select count(*)::int from messages where direction = 'inbound' and sent_at >= ${since}) as inbound,
      (select count(*)::int from messages where direction = 'outbound' and status <> 'failed' and sent_at >= ${since}) as outbound,
      (select count(*)::int from messages where direction = 'outbound' and status <> 'failed' and raw_payload->>'source' = 'agent' and sent_at >= ${since}) as agent,
      (select count(*)::int from messages where direction = 'outbound' and status <> 'failed' and coalesce(raw_payload->>'source', 'human') <> 'agent' and sent_at >= ${since}) as human,
      (select count(*)::int from messages where status = 'failed' and sent_at >= ${since}) as failed,
      (select coalesce(sum(unread_count), 0)::int from conversations) as unread
  `);

  // Primera respuesta: desde el mensaje del cliente que abre un turno hasta la siguiente salida.
  const [response] = await db.execute<{ median: number | null }>(sql`
    with turns as (
      select m.conversation_id, m.sent_at,
             lag(m.direction) over (partition by m.conversation_id order by m.sent_at) as prev
      from messages m
      where m.status <> 'failed'
    )
    select percentile_cont(0.5) within group (order by extract(epoch from (o.sent_at - t.sent_at)))::float as median
    from turns t
    join lateral (
      select sent_at from messages o
      where o.conversation_id = t.conversation_id and o.direction = 'outbound'
        and o.status <> 'failed' and o.sent_at > t.sent_at
      order by o.sent_at limit 1
    ) o on true
    where t.sent_at >= ${since}
      and (t.prev is null or t.prev = 'outbound')
      and exists (select 1 from messages i where i.conversation_id = t.conversation_id and i.sent_at = t.sent_at and i.direction = 'inbound')
  `);

  const byChannel = await db.execute<{ channel: Channel; conversations: number; inbound: number }>(sql`
    select ch.channel,
      (select count(*)::int from conversations c where c.channel = ch.channel) as conversations,
      (select count(*)::int from messages m where m.channel = ch.channel and m.direction = 'inbound' and m.sent_at >= ${since}) as inbound
    from unnest(array['whatsapp','instagram','facebook']::channel[]) as ch(channel)
  `);

  const daily = await db.execute<{ day: string; inbound: number }>(sql`
    select to_char(d.day, 'YYYY-MM-DD') as day, count(m.id)::int as inbound
    from generate_series(
      (now() at time zone ${TZ})::date - (${days} - 1),
      (now() at time zone ${TZ})::date,
      interval '1 day'
    ) as d(day)
    left join messages m on m.direction = 'inbound'
      and (m.sent_at at time zone ${TZ})::date = d.day::date
    group by d.day
    order by d.day
  `);

  return {
    days,
    newConversations: totals.new_conversations,
    inbound: totals.inbound,
    outbound: totals.outbound,
    agentReplies: totals.agent,
    humanReplies: totals.human,
    failed: totals.failed,
    unread: totals.unread,
    medianFirstResponseSec: response?.median ?? null,
    byChannel: [...byChannel],
    daily: [...daily],
  };
}
