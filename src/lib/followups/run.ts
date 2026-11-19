import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { followupEnrollments, followupSequences, followupSteps } from "@/db/schema";
import { canAutomate } from "@/lib/agency/lifecycle";
import { audienceWhere, normalizeSources } from "@/lib/crm/groups";
import { deliverMessage } from "@/lib/inbox/deliver";
import { computeWindow } from "@/lib/inbox/window";
import { safeError } from "@/lib/safe-error";
import { localDay, nextSendTime, renderStep } from "./logic";

// Seguimientos automáticos. Corre cada minuto desde el worker (o /api/cron/jobs). Dos pasos:
//   1. INSCRIBIR: conversaciones donde la última palabra fue nuestra, la ventana sigue abierta y el
//      contacto entra en la audiencia. Un ciclo por cada mensaje del cliente: después de contestar,
//      puede volver a entrar cuando vuelva a callar.
//   2. DESPACHAR: los pasos vencidos. Antes de enviar se vuelve a comprobar TODO (ventana, baja,
//      derivación, cierre, que no contestó, que no esté hablando con el bot o recibiendo una campaña).
// Una inscripción se reclama con lease y avanza con una actualización condicional sobre next_position:
// el mismo paso no sale dos veces aunque dos procesos corran a la vez. La clave de idempotencia del
// envío (`followup:<inscripción>:<paso>`) cubre además el reintento después de un reinicio.

const ENROLL_LIMIT = 500;
const DISPATCH_LIMIT = 50;
const LEASE_SEC = 120;
const POSTPONE_MS = 10 * 60_000;
const TYPING_FRESH_SEC = 30;

type Seq = typeof followupSequences.$inferSelect;

export async function runFollowupsTick(): Promise<Record<string, number>> {
  const enrolled = await enrollAll();
  const d = await dispatchDue();
  return { enrolled, ...d };
}

async function enrollAll(): Promise<number> {
  const db = getDb();
  const seqs = await db.select().from(followupSequences).where(eq(followupSequences.enabled, true));
  let total = 0;
  for (const seq of seqs) {
    if (!(await canAutomate(seq.organizationId))) continue;
    const [first] = await db
      .select()
      .from(followupSteps)
      .where(and(eq(followupSteps.sequenceId, seq.id), eq(followupSteps.organizationId, seq.organizationId)))
      .orderBy(asc(followupSteps.position))
      .limit(1);
    if (!first) continue;
    total += await enrollForSequence(seq, first.delayMinutes).catch((err: unknown) => {
      console.error(`[seguimientos] inscripción ${seq.id}: ${safeError(err)}`);
      return 0;
    });
  }
  return total;
}

async function enrollForSequence(seq: Seq, firstDelayMinutes: number): Promise<number> {
  const orgId = seq.organizationId;
  const audience = await audienceWhere(orgId, normalizeSources(seq.audience));
  const account = seq.channelAccountId ? sql`and cv.channel_account_id = ${seq.channelAccountId}` : sql``;
  const handoff = seq.stopOnHandoff ? sql`and cv.ai_enabled` : sql``;
  const closed = seq.stopOnDealClosed
    ? sql`and not (
        exists (select 1 from deals d where d.contact_id = cv.contact_id and d.organization_id = ${orgId} and d.status in ('ganada', 'perdida'))
        and not exists (select 1 from deals d where d.contact_id = cv.contact_id and d.organization_id = ${orgId} and d.status = 'abierta')
      )`
    : sql``;
  const rows = await getDb().execute<{ id: string }>(sql`
    insert into followup_enrollments (organization_id, sequence_id, conversation_id, contact_id, status, next_position, anchor_at, next_run_at)
    select ${orgId}, ${seq.id}, cv.id, cv.contact_id, 'activa', 1, last.sent_at,
           last.sent_at + (${firstDelayMinutes} * interval '1 minute')
    from conversations cv
    join contacts c on c.id = cv.contact_id and c.organization_id = ${orgId}
    join lateral (
      select m.direction, m.sent_at from messages m
      where m.conversation_id = cv.id and m.organization_id = ${orgId} and m.status <> 'failed'
      order by m.sent_at desc limit 1
    ) last on true
    where cv.organization_id = ${orgId}
      and cv.status = 'activa'
      and coalesce(cv.metadata->>'delegation', '') = ''
      and cv.last_inbound_at > now() - interval '24 hours'
      and last.direction = 'outbound'
      and c.marketing_opt_out_at is null and c.anonymized_at is null
      ${account} ${handoff} ${closed}
      and ${audience}
      -- Un ciclo por cada mensaje del cliente: si ya hubo una inscripción después de su último mensaje, no otra.
      and not exists (
        select 1 from followup_enrollments e
        where e.sequence_id = ${seq.id} and e.conversation_id = cv.id and e.created_at > cv.last_inbound_at
      )
    limit ${ENROLL_LIMIT}
    on conflict do nothing
    returning id
  `);
  return rows.length;
}

async function dispatchDue(): Promise<Record<string, number>> {
  const db = getDb();
  const claimed = await db.execute<{ id: string }>(sql`
    update followup_enrollments set lease_until = now() + (${LEASE_SEC} * interval '1 second'), updated_at = now()
    where id in (
      select id from followup_enrollments
      where status = 'activa' and next_run_at <= now() and (lease_until is null or lease_until < now())
      order by next_run_at limit ${DISPATCH_LIMIT}
      for update skip locked
    )
    returning id
  `);
  const out = { sent: 0, postponed: 0, stopped: 0, completed: 0, failed: 0 };
  for (const { id } of claimed) {
    const r = await dispatchOne(id).catch((err: unknown) => {
      console.error(`[seguimientos] ${id}: ${safeError(err)}`);
      return "failed" as const;
    });
    out[r]++;
  }
  return out;
}

type Outcome = "sent" | "postponed" | "stopped" | "completed" | "failed";

async function dispatchOne(enrollmentId: string): Promise<Outcome> {
  const db = getDb();
  const [e] = await db.select().from(followupEnrollments).where(eq(followupEnrollments.id, enrollmentId));
  if (!e || e.status !== "activa") return "stopped";
  const orgId = e.organizationId;

  const release = (patch: Partial<typeof followupEnrollments.$inferInsert>) =>
    db
      .update(followupEnrollments)
      .set({ ...patch, leaseUntil: null, updatedAt: new Date() })
      .where(and(eq(followupEnrollments.id, e.id), eq(followupEnrollments.status, "activa"), eq(followupEnrollments.nextPosition, e.nextPosition)));
  const stopWith = async (reason: string, status: "detenida" | "respondio" | "completada" = "detenida") => {
    await release({ status, stopReason: reason, nextRunAt: null });
    return status === "completada" ? ("completed" as const) : ("stopped" as const);
  };
  const postpone = async (ms = POSTPONE_MS) => {
    await release({ nextRunAt: new Date(Date.now() + ms) });
    return "postponed" as const;
  };

  // Suspendida: no se corta la secuencia, se posterga (al reactivar sigue si la ventana lo permite).
  if (!(await canAutomate(orgId))) return postpone(30 * 60_000);

  const [seq] = await db.select().from(followupSequences).where(and(eq(followupSequences.id, e.sequenceId), eq(followupSequences.organizationId, orgId)));
  if (!seq || !seq.enabled) return stopWith("secuencia_apagada");
  const [step] = await db
    .select()
    .from(followupSteps)
    .where(and(eq(followupSteps.sequenceId, seq.id), eq(followupSteps.organizationId, orgId), eq(followupSteps.position, e.nextPosition)));
  if (!step) return stopWith("sin_mas_pasos", "completada");

  const [conv] = await db.execute<{
    id: string; channel: "whatsapp" | "instagram" | "facebook"; last_inbound_at: string | null; ai_enabled: boolean; status: string;
    delegated: boolean; name: string | null; opted_out: boolean; anonymized: boolean; deal_closed: boolean; busy_triage: boolean;
    busy_campaign: boolean; human_typing: boolean; last_automated_at: string | null; inbound_after_anchor: boolean;
  }>(sql`
    select cv.id, cv.channel::text as channel, cv.last_inbound_at::text, cv.ai_enabled, cv.status,
      coalesce(cv.metadata->>'delegation', '') <> '' as delegated,
      coalesce(c.name, cv.participant_name) as name,
      coalesce(c.marketing_opt_out_at is not null, false) as opted_out,
      coalesce(c.anonymized_at is not null, false) as anonymized,
      (exists (select 1 from deals d where d.contact_id = cv.contact_id and d.organization_id = ${orgId} and d.status in ('ganada', 'perdida'))
        and not exists (select 1 from deals d where d.contact_id = cv.contact_id and d.organization_id = ${orgId} and d.status = 'abierta')) as deal_closed,
      exists (select 1 from jobs j where j.kind = 'triage' and j.organization_id = ${orgId} and j.status in ('queued', 'running', 'failed')
        and j.payload->>'conversationId' = cv.id::text) as busy_triage,
      exists (select 1 from campaign_recipients r join campaign_batches b on b.id = r.batch_id
        where r.conversation_id = cv.id and r.organization_id = ${orgId} and r.status in ('pendiente', 'enviando') and b.status = 'enviando') as busy_campaign,
      (cv.human_typing_since is not null and cv.human_typing_since > now() - (${TYPING_FRESH_SEC} * interval '1 second')) as human_typing,
      (select max(m.sent_at)::text from messages m where m.conversation_id = cv.id and m.organization_id = ${orgId}
        and m.direction = 'outbound' and m.raw_payload->>'source' in ('agent', 'campaign', 'followup')) as last_automated_at,
      exists (select 1 from messages m where m.conversation_id = cv.id and m.organization_id = ${orgId}
        and m.direction = 'inbound' and m.sent_at > ${e.anchorAt.toISOString()}::timestamptz) as inbound_after_anchor
    from conversations cv
    left join contacts c on c.id = cv.contact_id and c.organization_id = ${orgId}
    where cv.id = ${e.conversationId} and cv.organization_id = ${orgId}
  `);
  if (!conv) return stopWith("conversacion_inexistente");

  // Condiciones de fin (re-evaluadas al enviar, aunque estuviera programado).
  if (conv.inbound_after_anchor) {
    await release({ status: "respondio", respondedAt: new Date(), stopReason: "respondio", nextRunAt: null });
    return "stopped";
  }
  if (conv.opted_out || conv.anonymized) return stopWith("baja");
  if (conv.delegated || conv.status !== "activa") return stopWith("conversacion_cerrada");
  if (seq.stopOnHandoff && !conv.ai_enabled) return stopWith("derivada_a_persona");
  if (seq.stopOnDealClosed && conv.deal_closed) return stopWith("oportunidad_cerrada");
  // No superponer: el bot está por contestar, sale una campaña o una persona está escribiendo.
  if (conv.busy_triage || conv.busy_campaign || conv.human_typing) return postpone(5 * 60_000);

  const window = computeWindow(conv.channel, conv.last_inbound_at ? new Date(conv.last_inbound_at) : null);
  if (window.state !== "open" || !window.expiresAt) return stopWith("ventana_cerrada");

  const sentPerDay = await followupsPerDay(orgId, conv.id, seq.timezone);
  const plan = nextSendTime({
    desiredAt: new Date(e.anchorAt.getTime() + step.delayMinutes * 60_000),
    lastAutomatedAt: conv.last_automated_at ? new Date(conv.last_automated_at) : null,
    minGapMinutes: seq.minGapMinutes,
    timeZone: seq.timezone,
    allowedStartHour: seq.allowedStartHour,
    allowedEndHour: seq.allowedEndHour,
    maxPerDay: seq.maxPerDay,
    sentPerDay,
    windowExpiresAt: new Date(window.expiresAt),
    windowMarginMinutes: seq.windowMarginMinutes,
  });
  if (!plan.at) return stopWith(plan.reason);
  if (plan.at.getTime() > Date.now() + 30_000) {
    await release({ nextRunAt: plan.at });
    return "postponed";
  }

  const text = renderStep(step.body, conv.name);
  if (!text) return stopWith("texto_vacio");
  const res = await deliverMessage(conv.id, {
    text,
    source: "followup",
    organizationId: orgId,
    idempotencyKey: `followup:${e.id}:${e.nextPosition}`,
  });
  if (!res.ok) {
    if (res.code === "window_closed") return stopWith("ventana_cerrada");
    if (res.code === "org_inactive") return postpone(30 * 60_000);
    if (res.code === "not_found") return stopWith("conversacion_inexistente");
    await release({ nextRunAt: new Date(Date.now() + POSTPONE_MS), stopReason: `reintento: ${res.error.slice(0, 120)}` });
    return "failed";
  }

  // Avanza SOLO si nadie lo avanzó antes (condición sobre next_position).
  const [nextStep] = await db
    .select({ delayMinutes: followupSteps.delayMinutes })
    .from(followupSteps)
    .where(and(eq(followupSteps.sequenceId, seq.id), eq(followupSteps.position, e.nextPosition + 1)));
  const now = new Date();
  await db
    .update(followupEnrollments)
    .set({
      nextPosition: e.nextPosition + 1,
      anchorAt: now,
      sentCount: e.sentCount + 1,
      lastMessageId: res.message.id,
      stopReason: null,
      leaseUntil: null,
      updatedAt: now,
      ...(nextStep
        ? { nextRunAt: new Date(now.getTime() + nextStep.delayMinutes * 60_000) }
        : { status: "completada", nextRunAt: null, stopReason: "sin_mas_pasos" }),
    })
    .where(and(eq(followupEnrollments.id, e.id), eq(followupEnrollments.status, "activa"), eq(followupEnrollments.nextPosition, e.nextPosition)));
  return "sent";
}

async function followupsPerDay(orgId: string, conversationId: string, timeZone: string): Promise<Record<string, number>> {
  const rows = await getDb().execute<{ sent_at: string }>(sql`
    select sent_at::text from messages
    where conversation_id = ${conversationId} and organization_id = ${orgId} and direction = 'outbound'
      and raw_payload->>'source' = 'followup' and sent_at > now() - interval '48 hours'
  `);
  const out: Record<string, number> = {};
  for (const r of rows) {
    const d = localDay(new Date(r.sent_at), timeZone);
    out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

export const STOP_REASON_LABEL: Record<string, string> = {
  respondio: "El contacto respondió",
  baja: "Pidió la baja",
  conversacion_cerrada: "Conversación archivada o delegada",
  derivada_a_persona: "Derivada a una persona",
  oportunidad_cerrada: "Oportunidad cerrada",
  ventana_cerrada: "Se cerró la ventana del canal",
  no_entra_en_la_ventana: "El próximo paso no entraba en la ventana",
  horario_invalido: "Horario de la secuencia inválido",
  secuencia_apagada: "La secuencia se apagó",
  sin_mas_pasos: "Completó todos los pasos",
  texto_vacio: "El texto del paso quedó vacío",
  conversacion_inexistente: "La conversación ya no existe",
};
