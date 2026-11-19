import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { channelAccounts, followupSequences, followupSteps } from "@/db/schema";
import { normalizeSources, type AudienceSources } from "@/lib/crm/groups";
import { validateSteps, type StepDraft } from "./logic";

export type Sequence = typeof followupSequences.$inferSelect;

export async function listSequences(orgId: string) {
  return getDb().execute<{
    id: string; name: string; enabled: boolean; steps: number; activas: number; enviados: number; reactivadas: number; detenidas: number;
  }>(sql`
    select s.id, s.name, s.enabled,
      (select count(*)::int from followup_steps st where st.sequence_id = s.id and st.organization_id = ${orgId}) as steps,
      count(e.id) filter (where e.status = 'activa')::int as activas,
      coalesce(sum(e.sent_count), 0)::int as enviados,
      count(e.id) filter (where e.status = 'respondio' and e.sent_count > 0)::int as reactivadas,
      count(e.id) filter (where e.status = 'detenida')::int as detenidas
    from followup_sequences s
    left join followup_enrollments e on e.sequence_id = s.id and e.organization_id = ${orgId}
    where s.organization_id = ${orgId}
    group by s.id order by s.created_at desc
  `);
}

export async function getSequence(orgId: string, id: string) {
  const [seq] = await getDb().select().from(followupSequences).where(and(eq(followupSequences.id, id), eq(followupSequences.organizationId, orgId)));
  if (!seq) return null;
  const steps = await getDb()
    .select()
    .from(followupSteps)
    .where(and(eq(followupSteps.sequenceId, id), eq(followupSteps.organizationId, orgId)))
    .orderBy(asc(followupSteps.position));
  return { seq, steps };
}

export type SequenceInput = {
  id?: string;
  name: string;
  channelAccountId: string | null;
  audience: AudienceSources;
  timezone: string;
  allowedStartHour: number;
  allowedEndHour: number;
  maxPerDay: number;
  minGapMinutes: number;
  windowMarginMinutes: number;
  stopOnHandoff: boolean;
  stopOnDealClosed: boolean;
  steps: StepDraft[];
};

const VALID_TZ = (tz: string) => {
  try {
    new Intl.DateTimeFormat("es-AR", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export function validateSequence(input: SequenceInput): string | null {
  if (!input.name.trim()) return "La secuencia necesita un nombre.";
  if (!VALID_TZ(input.timezone)) return "La zona horaria no es válida.";
  if (!(input.allowedStartHour >= 0 && input.allowedEndHour <= 24 && input.allowedStartHour < input.allowedEndHour)) return "El horario permitido no es válido.";
  if (!(input.maxPerDay >= 1 && input.maxPerDay <= 10)) return "El máximo por día tiene que estar entre 1 y 10.";
  if (!(input.minGapMinutes >= 15 && input.minGapMinutes <= 12 * 60)) return "La separación mínima tiene que estar entre 15 minutos y 12 horas.";
  if (!(input.windowMarginMinutes >= 0 && input.windowMarginMinutes <= 180)) return "El margen de la ventana tiene que estar entre 0 y 180 minutos.";
  return validateSteps(input.steps);
}

/** Crea o reemplaza una secuencia con sus pasos, en una transacción. Se guarda APAGADA si es nueva. */
export async function saveSequence(orgId: string, userId: string, input: SequenceInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const error = validateSequence(input);
  if (error) return { ok: false, error };
  const db = getDb();
  if (input.channelAccountId) {
    const [acc] = await db
      .select({ id: channelAccounts.id })
      .from(channelAccounts)
      .where(and(eq(channelAccounts.id, input.channelAccountId), eq(channelAccounts.organizationId, orgId)));
    if (!acc) return { ok: false, error: "La cuenta elegida no es de esta inmobiliaria." };
  }
  const values = {
    name: input.name.trim().slice(0, 80),
    channelAccountId: input.channelAccountId,
    audience: normalizeSources(input.audience),
    timezone: input.timezone,
    allowedStartHour: input.allowedStartHour,
    allowedEndHour: input.allowedEndHour,
    maxPerDay: input.maxPerDay,
    minGapMinutes: input.minGapMinutes,
    windowMarginMinutes: input.windowMarginMinutes,
    stopOnHandoff: input.stopOnHandoff,
    stopOnDealClosed: input.stopOnDealClosed,
  };
  const id = await db.transaction(async (tx) => {
    let seqId = input.id;
    if (seqId) {
      const [row] = await tx
        .update(followupSequences)
        .set(values)
        .where(and(eq(followupSequences.id, seqId), eq(followupSequences.organizationId, orgId)))
        .returning({ id: followupSequences.id });
      if (!row) return null;
    } else {
      const [row] = await tx.insert(followupSequences).values({ ...values, organizationId: orgId, createdBy: userId, enabled: false }).returning({ id: followupSequences.id });
      seqId = row.id;
    }
    // Los pasos se reemplazan enteros. Las inscripciones activas siguen por su next_position: si el paso
    // ya no existe, terminan como completadas (run.ts) en vez de mandar algo que el admin sacó.
    await tx.delete(followupSteps).where(and(eq(followupSteps.sequenceId, seqId!), eq(followupSteps.organizationId, orgId)));
    await tx.insert(followupSteps).values(
      input.steps.map((s, i) => ({ organizationId: orgId, sequenceId: seqId!, position: i + 1, delayMinutes: s.delayMinutes, body: s.body.trim() })),
    );
    return seqId!;
  });
  return id ? { ok: true, id } : { ok: false, error: "No se encontró la secuencia." };
}

export async function setSequenceEnabled(orgId: string, id: string, enabled: boolean) {
  await getDb()
    .update(followupSequences)
    .set({ enabled })
    .where(and(eq(followupSequences.id, id), eq(followupSequences.organizationId, orgId)));
  // Apagar no deja pasos pendientes: las activas se detienen con motivo visible.
  if (!enabled) {
    await getDb().execute(sql`
      update followup_enrollments set status = 'detenida', stop_reason = 'secuencia_apagada', next_run_at = null, lease_until = null, updated_at = now()
      where sequence_id = ${id} and organization_id = ${orgId} and status = 'activa'
    `);
  }
}

export async function deleteSequence(orgId: string, id: string) {
  await getDb().delete(followupSequences).where(and(eq(followupSequences.id, id), eq(followupSequences.organizationId, orgId)));
}

export async function recentEnrollments(orgId: string, sequenceId: string, limit = 50) {
  return getDb().execute<{
    id: string; conversation_id: string; name: string | null; status: string; next_position: number; sent_count: number; next_run_at: string | null; stop_reason: string | null; updated_at: string;
  }>(sql`
    select e.id, e.conversation_id, coalesce(c.name, cv.participant_name) as name, e.status, e.next_position, e.sent_count,
      e.next_run_at::text, e.stop_reason, e.updated_at::text
    from followup_enrollments e
    join conversations cv on cv.id = e.conversation_id and cv.organization_id = ${orgId}
    left join contacts c on c.id = e.contact_id and c.organization_id = ${orgId}
    where e.sequence_id = ${sequenceId} and e.organization_id = ${orgId}
    order by e.updated_at desc limit ${limit}
  `);
}

export const sequenceOrder = desc(followupSequences.createdAt);
