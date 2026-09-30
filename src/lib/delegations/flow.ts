import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  auditLogs,
  contacts,
  conversationDelegations,
  conversationEvents,
  conversations,
  messages,
  networkMembers,
  networks,
  organizations,
  prospectRequirements,
} from "@/db/schema";

// Delegación de conversaciones en una red. Reglas que sostienen todo lo de abajo:
//  - la conversación NO cambia de organización: mensajes, identidades, cuentas y webhooks siguen
//    anclados a su tenant y proveedor de origen;
//  - delegar crea una SOLICITUD; antes de tomarla solo se ve un resumen sin mensajes ni datos de contacto;
//  - tomarla es atómica (una sola inmobiliaria gana) y le crea a la receptora un expediente propio,
//    de solo lectura, con lo que el origen autorizó compartir. No se promete poder responder por el
//    mismo canal: la cuenta del canal es del origen.

export type Delegation = typeof conversationDelegations.$inferSelect;
export const DELEGATED_FLAG = "delegation"; // conversations.metadata.delegation

const SNAPSHOT_MESSAGES = 100;

/** Redes activas en las que participa la inmobiliaria (miembro activa y red activa). */
export async function activeNetworkIds(orgId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: networks.id })
    .from(networkMembers)
    .innerJoin(networks, eq(networks.id, networkMembers.networkId))
    .where(and(eq(networkMembers.organizationId, orgId), sql`${networkMembers.status}::text = 'activa'`, eq(networks.status, "activa")));
  return rows.map((r) => r.id);
}

export type CreateDelegationInput = {
  orgId: string;
  userId: string;
  conversationId: string;
  note: string | null;
  scope: { history: boolean; phone: boolean };
};

export async function createDelegation(input: CreateDelegationInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const db = getDb();
  const [conv] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, input.conversationId), eq(conversations.organizationId, input.orgId)));
  if (!conv) return { ok: false, error: "No se encontró la conversación." };
  if ((conv.metadata as Record<string, unknown>)?.[DELEGATED_FLAG]) return { ok: false, error: "Esta conversación ya es un expediente delegado." };

  const nets = await activeNetworkIds(input.orgId);
  if (!nets.length) return { ok: false, error: "Tu inmobiliaria no pertenece a ninguna red activa." };

  // Lo que se ve antes de tomarla: canal, qué busca y la nota. Sin nombre, teléfono ni mensajes.
  const [req] = conv.contactId
    ? await db
        .select()
        .from(prospectRequirements)
        .where(and(eq(prospectRequirements.contactId, conv.contactId), eq(prospectRequirements.organizationId, input.orgId), eq(prospectRequirements.status, "activo")))
        .orderBy(desc(prospectRequirements.updatedAt))
        .limit(1)
    : [];
  const summary = {
    channel: conv.channel,
    operation: req?.operation ?? null,
    zones: req?.zones ?? [],
    propertyTypes: req?.propertyTypes ?? [],
    budget: req && (req.priceMin || req.priceMax) ? { min: req.priceMin, max: req.priceMax, currency: req.currency } : null,
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
  };

  try {
    const [row] = await db
      .insert(conversationDelegations)
      .values({
        networkId: nets[0],
        sourceOrganizationId: input.orgId,
        sourceConversationId: conv.id,
        status: "pendiente",
        note: input.note,
        scope: input.scope,
        summary,
        createdBy: input.userId,
      })
      .returning({ id: conversationDelegations.id });
    await db
      .insert(conversationEvents)
      .values({ organizationId: input.orgId, conversationId: conv.id, actorUserId: input.userId, action: "delegada", toValue: row.id })
      .catch(() => {});
    return { ok: true, id: row.id };
  } catch (err) {
    // El índice único parcial: ya hay una solicitud viva para esta conversación.
    if ((err as { cause?: { code?: string } }).cause?.code === "23505" || (err as { code?: string }).code === "23505") {
      return { ok: false, error: "Esta conversación ya tiene una solicitud de delegación pendiente." };
    }
    throw err;
  }
}

export type OpenDelegation = {
  id: string;
  sourceName: string;
  note: string | null;
  summary: Record<string, unknown>;
  scope: { history: boolean; phone: boolean };
  createdAt: string;
  mine: boolean;
};

/**
 * Solicitudes pendientes visibles para la inmobiliaria: las de sus redes activas, dirigidas a ella o
 * abiertas. Las propias aparecen marcadas (`mine`) para poder cancelarlas, pero no se pueden tomar.
 */
export async function listOpenDelegations(orgId: string): Promise<OpenDelegation[]> {
  const nets = await activeNetworkIds(orgId);
  if (!nets.length) return [];
  const rows = await getDb()
    .select({
      id: conversationDelegations.id,
      sourceOrgId: conversationDelegations.sourceOrganizationId,
      sourceName: organizations.name,
      note: conversationDelegations.note,
      summary: conversationDelegations.summary,
      scope: conversationDelegations.scope,
      createdAt: conversationDelegations.createdAt,
    })
    .from(conversationDelegations)
    .innerJoin(organizations, eq(organizations.id, conversationDelegations.sourceOrganizationId))
    .where(
      and(
        eq(conversationDelegations.status, "pendiente"),
        inArray(conversationDelegations.networkId, nets),
        or(
          eq(conversationDelegations.sourceOrganizationId, orgId),
          isNull(conversationDelegations.targetOrganizationId),
          eq(conversationDelegations.targetOrganizationId, orgId),
        ),
      ),
    )
    .orderBy(desc(conversationDelegations.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    sourceName: r.sourceName,
    note: r.note,
    summary: r.summary,
    scope: r.scope,
    createdAt: r.createdAt.toISOString(),
    mine: r.sourceOrgId === orgId,
  }));
}

export const countOpenDelegations = async (orgId: string) => (await listOpenDelegations(orgId)).filter((d) => !d.mine).length;

/** Estado de delegación de una conversación de origen (para mostrar "Delegada" en su cabecera). */
export async function getDelegationOfConversation(orgId: string, conversationId: string): Promise<Delegation | null> {
  const [row] = await getDb()
    .select()
    .from(conversationDelegations)
    .where(and(eq(conversationDelegations.sourceConversationId, conversationId), eq(conversationDelegations.sourceOrganizationId, orgId)))
    .orderBy(desc(conversationDelegations.createdAt))
    .limit(1);
  return row ?? null;
}

export type TakeResult = { ok: true; conversationId: string } | { ok: false; error: string };

/**
 * Toma atómica. El UPDATE condicional (pendiente -> tomada) deja pasar a UNA sola inmobiliaria: la
 * segunda encuentra cero filas. Todo ocurre en una transacción, así no queda una solicitud "tomada"
 * sin su expediente.
 */
export async function takeDelegation(input: { orgId: string; userId: string; delegationId: string }): Promise<TakeResult> {
  const nets = await activeNetworkIds(input.orgId);
  if (!nets.length) return { ok: false, error: "Tu inmobiliaria no pertenece a ninguna red activa." };

  return getDb().transaction(async (tx) => {
    const [claimed] = await tx
      .update(conversationDelegations)
      .set({ status: "tomada", takenByOrganizationId: input.orgId, takenByUserId: input.userId, takenAt: new Date(), updatedAt: sql`now()` })
      .where(
        and(
          eq(conversationDelegations.id, input.delegationId),
          eq(conversationDelegations.status, "pendiente"),
          inArray(conversationDelegations.networkId, nets),
          ne(conversationDelegations.sourceOrganizationId, input.orgId),
          or(isNull(conversationDelegations.targetOrganizationId), eq(conversationDelegations.targetOrganizationId, input.orgId)),
        ),
      )
      .returning();
    if (!claimed) return { ok: false as const, error: "Otra inmobiliaria ya la tomó, o ya no está disponible." };

    const [source] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, claimed.sourceConversationId), eq(conversations.organizationId, claimed.sourceOrganizationId)));
    if (!source) throw new Error("La conversación de origen ya no existe");
    const [sourceOrg] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, claimed.sourceOrganizationId));
    const [contact] = source.contactId
      ? await tx.select().from(contacts).where(and(eq(contacts.id, source.contactId), eq(contacts.organizationId, claimed.sourceOrganizationId)))
      : [];

    const name = contact?.name ?? source.participantName ?? "Contacto delegado";
    // Contacto propio de la receptora. El teléfono viaja solo si el origen lo autorizó.
    const [newContact] = await tx
      .insert(contacts)
      .values({ organizationId: input.orgId, name, phone: claimed.scope.phone ? (contact?.phone ?? null) : null })
      .returning({ id: contacts.id });

    const [dossier] = await tx
      .insert(conversations)
      .values({
        organizationId: input.orgId,
        contactId: newContact.id,
        channel: source.channel,
        provider: source.provider,
        externalId: `delegada:${claimed.id}`,
        accountId: "delegada",
        participantName: name,
        aiEnabled: false,
        lastMessageAt: source.lastMessageAt,
        metadata: {
          [DELEGATED_FLAG]: { id: claimed.id, fromOrganization: sourceOrg?.name ?? "otra inmobiliaria", note: claimed.note, readOnly: true },
        },
      })
      .returning({ id: conversations.id });

    if (claimed.scope.history) {
      const history = await tx
        .select({ direction: messages.direction, body: messages.body, sentAt: messages.sentAt })
        .from(messages)
        .where(and(eq(messages.conversationId, source.id), eq(messages.organizationId, claimed.sourceOrganizationId), sql`${messages.body} is not null`))
        .orderBy(desc(messages.sentAt))
        .limit(SNAPSHOT_MESSAGES);
      if (history.length) {
        await tx.insert(messages).values(
          history.reverse().map((m) => ({
            organizationId: input.orgId,
            conversationId: dossier.id,
            channel: source.channel,
            provider: source.provider,
            direction: m.direction,
            type: "text",
            body: m.body,
            status: (m.direction === "inbound" ? "received" : "sent") as "received" | "sent",
            rawPayload: { source: "delegacion" },
            sentAt: m.sentAt,
          })),
        );
      }
    }

    await tx.update(conversationDelegations).set({ takenConversationId: dossier.id }).where(eq(conversationDelegations.id, claimed.id));

    // Origen: el hilo queda desactivado y sin bot, con el rastro de a quién pasó. No se reabre solo
    // si después llega otro mensaje (ingest no toca `status`).
    await tx
      .update(conversations)
      .set({ status: "desactiva", statusChangedAt: new Date(), aiEnabled: false })
      .where(eq(conversations.id, source.id));
    await tx.insert(conversationEvents).values([
      { organizationId: claimed.sourceOrganizationId, conversationId: source.id, actorUserId: input.userId, action: "tomada", toValue: input.orgId },
      { organizationId: input.orgId, conversationId: dossier.id, actorUserId: input.userId, action: "tomada", fromValue: claimed.sourceOrganizationId },
    ]);
    await tx.insert(auditLogs).values({
      actorUserId: input.userId,
      actingAsOrganizationId: input.orgId,
      action: "delegation.take",
      target: claimed.id,
      metadata: { from: claimed.sourceOrganizationId, history: claimed.scope.history, phone: claimed.scope.phone },
    });
    return { ok: true as const, conversationId: dossier.id };
  });
}

/** El origen retira su solicitud mientras siga pendiente. */
export async function cancelDelegation(orgId: string, userId: string, delegationId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .update(conversationDelegations)
    .set({ status: "cancelada", updatedAt: sql`now()` })
    .where(and(eq(conversationDelegations.id, delegationId), eq(conversationDelegations.sourceOrganizationId, orgId), eq(conversationDelegations.status, "pendiente")))
    .returning({ conv: conversationDelegations.sourceConversationId });
  if (!row) return false;
  await db
    .insert(conversationEvents)
    .values({ organizationId: orgId, conversationId: row.conv, actorUserId: userId, action: "cancelada", toValue: delegationId })
    .catch(() => {});
  return true;
}

/** Solo la destinataria de una solicitud dirigida puede rechazarla. Las abiertas simplemente no se toman. */
export async function rejectDelegation(orgId: string, delegationId: string): Promise<boolean> {
  const [row] = await getDb()
    .update(conversationDelegations)
    .set({ status: "rechazada", updatedAt: sql`now()` })
    .where(and(eq(conversationDelegations.id, delegationId), eq(conversationDelegations.targetOrganizationId, orgId), eq(conversationDelegations.status, "pendiente")))
    .returning({ id: conversationDelegations.id });
  return Boolean(row);
}

export async function listEvents(orgId: string, conversationId: string) {
  return getDb()
    .select()
    .from(conversationEvents)
    .where(and(eq(conversationEvents.conversationId, conversationId), eq(conversationEvents.organizationId, orgId)))
    .orderBy(asc(conversationEvents.createdAt))
    .limit(50);
}
