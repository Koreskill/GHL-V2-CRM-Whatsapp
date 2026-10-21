import { and, desc, eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { agentFeedback, messages } from "@/db/schema";

// Tres capas, que no se mezclan:
// - MEMORIA de una conversación: su historial (messages) y el perfil del contacto. Solo vale para ese hilo.
// - CONOCIMIENTO de una inmobiliaria: su prompt (agent_configs), su catálogo y los EJEMPLOS APROBADOS de acá.
// - CONFIGURACIÓN del producto: las reglas base del código (generate.ts BASE_RULES), iguales para todos.
//
// Un mensaje de un cliente NUNCA se convierte solo en conocimiento: una persona marca una respuesta como
// problemática, un ADMIN escribe la corrección y la aprueba. Recién ahí se usa como ejemplo de estilo, y
// solo en el prompt de ESA inmobiliaria (todo filtrado por organization_id).

const MAX_EXAMPLES = 5;
const MAX_CHARS = 400;

export async function reportProblem(input: { orgId: string; userId: string; messageId: string; note: string | null }): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const [msg] = await db
    .select({ id: messages.id, conversationId: messages.conversationId, body: messages.body, sentAt: messages.sentAt, direction: messages.direction, source: sql<string | null>`${messages.rawPayload}->>'source'` })
    .from(messages)
    .where(and(eq(messages.id, input.messageId), eq(messages.organizationId, input.orgId)));
  if (!msg || msg.direction !== "outbound" || msg.source !== "agent") return { ok: false, error: "Solo se pueden reportar respuestas del agente." };
  // Lo que había preguntado el cliente justo antes: el contexto mínimo para entender el error.
  const [prev] = await db
    .select({ body: messages.body })
    .from(messages)
    .where(and(eq(messages.conversationId, msg.conversationId), eq(messages.organizationId, input.orgId), eq(messages.direction, "inbound"), lt(messages.sentAt, msg.sentAt)))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  const [existing] = await db
    .select({ id: agentFeedback.id })
    .from(agentFeedback)
    .where(and(eq(agentFeedback.organizationId, input.orgId), eq(agentFeedback.messageId, msg.id)));
  if (existing) return { ok: true };
  await db.insert(agentFeedback).values({
    organizationId: input.orgId,
    conversationId: msg.conversationId,
    messageId: msg.id,
    kind: "problema",
    customerText: prev?.body?.slice(0, 2000) ?? null,
    botText: msg.body?.slice(0, 2000) ?? null,
    note: input.note?.slice(0, 500) || null,
    createdBy: input.userId,
  });
  return { ok: true };
}

export async function listFeedback(orgId: string, status: "pendiente" | "aprobado" | "descartado" = "pendiente", limit = 50) {
  return getDb()
    .select()
    .from(agentFeedback)
    .where(and(eq(agentFeedback.organizationId, orgId), eq(agentFeedback.status, status)))
    .orderBy(desc(agentFeedback.createdAt))
    .limit(limit);
}

export async function feedbackCounts(orgId: string) {
  const rows = await getDb().execute<{ kind: string; status: string; n: number }>(sql`
    select kind, status, count(*)::int as n from agent_feedback where organization_id = ${orgId} group by kind, status
  `);
  return rows;
}

/** Un admin aprueba la corrección: pasa a ser un ejemplo de estilo de esta inmobiliaria. */
export async function approveAsExample(orgId: string, userId: string, id: string, correctedText: string) {
  const text = correctedText.trim().slice(0, 2000);
  if (!text) return { ok: false as const, error: "Escribí cómo tendría que haber respondido." };
  await getDb()
    .update(agentFeedback)
    .set({ kind: "ejemplo", status: "aprobado", correctedText: text, reviewedBy: userId, reviewedAt: new Date() })
    .where(and(eq(agentFeedback.id, id), eq(agentFeedback.organizationId, orgId)));
  cache.delete(orgId);
  return { ok: true as const };
}

/** Revisado sin convertirlo en ejemplo (queda registrado como problema) o descartado. */
export async function closeFeedback(orgId: string, userId: string, id: string, status: "aprobado" | "descartado") {
  await getDb()
    .update(agentFeedback)
    .set({ status, reviewedBy: userId, reviewedAt: new Date() })
    .where(and(eq(agentFeedback.id, id), eq(agentFeedback.organizationId, orgId)));
  cache.delete(orgId);
}

// Caché corto: se consulta en cada respuesta del bot.
const cache = new Map<string, { at: number; rows: { customer: string; reply: string }[] }>();

export async function approvedExamples(orgId: string): Promise<{ customer: string; reply: string }[]> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const rows = await getDb()
    .select({ customer: agentFeedback.customerText, reply: agentFeedback.correctedText })
    .from(agentFeedback)
    .where(and(eq(agentFeedback.organizationId, orgId), eq(agentFeedback.kind, "ejemplo"), eq(agentFeedback.status, "aprobado")))
    .orderBy(desc(agentFeedback.reviewedAt))
    .limit(MAX_EXAMPLES)
    .catch(() => []);
  const out: { customer: string; reply: string }[] = [];
  for (const r of rows) if (r.customer && r.reply) out.push({ customer: r.customer.slice(0, MAX_CHARS), reply: r.reply.slice(0, MAX_CHARS) });
  cache.set(orgId, { at: Date.now(), rows: out });
  return out;
}
