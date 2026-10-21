import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { organizationMembers, organizations } from "@/db/schema";
import { safeError } from "@/lib/safe-error";
import { createSupabaseAdmin, hasAdminKey } from "@/lib/supabase/admin";
import { forgetOrgStatus, normalizeOrgStatus } from "./lifecycle";

// Transiciones del ciclo de vida de una inmobiliaria. Efecto de cada una (ver lifecycle.ts para lo que
// lee cada módulo en cada estado):
//
// SUSPENDER  — corta YA el acceso de sus usuarios (getSession), el bot (los triajes en cola se saltean),
//              las campañas (enviando/programada pasan a pausada, con motivo), los seguimientos (se
//              posponen, no se pierden) y la red (sus publicaciones pasan a retirada). Lo entrante se
//              GUARDA. Nada se borra.
// REACTIVAR  — vuelve el acceso y lo automático. Las campañas quedan pausadas (un admin las reanuda a
//              mano: no se reenvía nada solo después de una suspensión) y las publicaciones en la red no
//              se republican solas.
// ELIMINAR   — ANONIMIZA (decisión 2026-10-20): se borran los datos personales y las credenciales, se
//              conservan filas y números para métricas agregadas. Irreversible. No toca recursos
//              compartidos (redes, publicaciones de otras inmobiliarias). Las cuentas de mensajería se
//              desasignan para poder dársele a otro cliente.

export type LifecycleResult = { ok: true; detail?: Record<string, number> } | { ok: false; error: string };

async function setStatus(orgId: string, status: string, reason: string | null) {
  await getDb()
    .update(organizations)
    .set({ status, statusReason: reason, statusChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
  forgetOrgStatus(orgId);
}

export async function suspendOrganization(orgId: string, reason: string | null): Promise<LifecycleResult> {
  const [org] = await getDb().select({ status: organizations.status }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { ok: false, error: "No existe la inmobiliaria." };
  if (normalizeOrgStatus(org.status) === "eliminada") return { ok: false, error: "La inmobiliaria ya fue eliminada." };
  await setStatus(orgId, "suspendida", reason);
  const db = getDb();
  const campaigns = await db.execute(sql`
    update campaign_batches set status = 'pausada', paused_at = now(), updated_at = now()
    where organization_id = ${orgId} and status in ('enviando', 'programada') returning id
  `);
  const listings = await db.execute(sql`
    update network_property_listings set status = 'retirada', updated_at = now()
    where owner_organization_id = ${orgId} and status = 'publicada' returning id
  `);
  return { ok: true, detail: { campanasPausadas: campaigns.length, publicacionesRetiradas: listings.length } };
}

export async function reactivateOrganization(orgId: string): Promise<LifecycleResult> {
  const [org] = await getDb().select({ status: organizations.status }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { ok: false, error: "No existe la inmobiliaria." };
  if (normalizeOrgStatus(org.status) !== "suspendida") return { ok: false, error: "Solo se reactiva una inmobiliaria suspendida." };
  await setStatus(orgId, "activa", null);
  return { ok: true };
}

/**
 * Elimina por anonimización. Exige que esté suspendida antes (dos pasos: nadie elimina por un clic) y
 * que se escriba el nombre exacto. Corre en UNA transacción: o se anonimiza todo o nada.
 */
export async function anonymizeOrganization(orgId: string, typedName: string): Promise<LifecycleResult> {
  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { ok: false, error: "No existe la inmobiliaria." };
  if (normalizeOrgStatus(org.status) !== "suspendida") return { ok: false, error: "Primero suspendela: la eliminación se hace sobre una inmobiliaria suspendida." };
  if (typedName.trim() !== org.name.trim()) return { ok: false, error: "El nombre escrito no coincide." };

  const counts: Record<string, number> = {};
  const run = async (key: string, q: ReturnType<typeof sql>, tx: typeof db) => {
    const rows = await tx.execute(q);
    counts[key] = rows.length;
  };

  await db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as typeof db;
    // Personas y conversaciones.
    await run("contactos", sql`update contacts set name = null, phone = null, email = null, anonymized_at = now(), updated_at = now() where organization_id = ${orgId} returning id`, tx);
    await run("identidades", sql`delete from contact_identities where organization_id = ${orgId} returning id`, tx);
    await run("conversaciones", sql`
      update conversations set participant_name = null, participant_handle = null, participant_id = null, participant_picture = null,
        metadata = '{}'::jsonb, ai_enabled = false, status = 'archivada', updated_at = now()
      where organization_id = ${orgId} returning id`, tx);
    await run("mensajes", sql`update messages set body = null, raw_payload = '{}'::jsonb, error = null where organization_id = ${orgId} returning id`, tx);
    await tx.execute(sql`update message_triage set draft_text = null, internal_summary = null, handoff_reason = null, route_reason = null, suggested_crm_updates = '{}'::jsonb, missing_information = '[]'::jsonb where organization_id = ${orgId}`);
    await tx.execute(sql`update prospect_requirements set raw_extraction = null, criteria = '{}'::jsonb where organization_id = ${orgId}`);
    await tx.execute(sql`update deals set title = null, notes = null, lost_reason = null, metadata = '{}'::jsonb where organization_id = ${orgId}`);
    await tx.execute(sql`update visits set notes = null, cancel_reason = null, metadata = '{}'::jsonb where organization_id = ${orgId}`);
    await tx.execute(sql`update deal_events set from_value = null, to_value = null, metadata = '{}'::jsonb where organization_id = ${orgId}`);
    await tx.execute(sql`update visit_events set from_value = null, to_value = null, metadata = '{}'::jsonb where organization_id = ${orgId}`);
    await tx.execute(sql`update conversation_delegations set note = null, summary = '{}'::jsonb where source_organization_id = ${orgId}`);
    await tx.execute(sql`delete from agent_feedback where organization_id = ${orgId}`);
    await tx.execute(sql`delete from lab_runs where organization_id = ${orgId}`);
    // Notas y documentos internos de las propiedades (lo comercial queda: no es dato personal).
    await tx.execute(sql`update properties set internal_notes = null, documents = '[]'::jsonb, owner_contact_id = null where organization_id = ${orgId}`);
    // Automático: todo detenido.
    await tx.execute(sql`update campaign_batches set status = 'cancelada', updated_at = now() where organization_id = ${orgId} and status not in ('completada', 'cancelada')`);
    await tx.execute(sql`update followup_sequences set enabled = false, updated_at = now() where organization_id = ${orgId}`);
    await tx.execute(sql`update followup_enrollments set status = 'detenida', stop_reason = 'inmobiliaria_eliminada', next_run_at = null where organization_id = ${orgId} and status = 'activa'`);
    await tx.execute(sql`update jobs set status = 'skipped', result = '{"reason":"inmobiliaria_eliminada"}'::jsonb where organization_id = ${orgId} and status in ('queued', 'failed', 'running')`);
    // Red y publicaciones públicas: retiradas. Los registros de presentaciones con OTRAS inmobiliarias quedan (son de ambas).
    await tx.execute(sql`update network_property_listings set status = 'retirada', updated_at = now() where owner_organization_id = ${orgId}`);
    await tx.execute(sql`update property_publications set status = 'pausada', updated_at = now() where organization_id = ${orgId}`);
    // Credenciales e integraciones: se borran (no se pueden "anonimizar").
    await run("integraciones", sql`delete from calendar_integrations where organization_id = ${orgId} returning id`, tx);
    await tx.execute(sql`delete from calendar_connections where organization_id = ${orgId}`);
    await tx.execute(sql`update property_sync_configs set enabled = false, updated_at = now() where organization_id = ${orgId}`);
    // Cuentas de mensajería: desasignadas (la misma cuenta de Zernio se puede dar a otro cliente).
    await run("cuentas", sql`delete from channel_accounts where organization_id = ${orgId} returning id`, tx);
    await tx.execute(sql`update organization_members set status = 'revoked', updated_at = now() where organization_id = ${orgId}`);
    await tx.execute(sql`
      update organizations set status = 'eliminada', status_reason = 'anonimizada', status_changed_at = now(),
        metadata = '{}'::jsonb, updated_at = now()
      where id = ${orgId}`);
  });
  forgetOrgStatus(orgId);

  // Fuera de la transacción (es otra API): se limpia el rol de Auth de cada usuario cuya organización era esta.
  counts.usuarios = await revokeAuthMembers(orgId);
  return { ok: true, detail: counts };
}

async function revokeAuthMembers(orgId: string): Promise<number> {
  if (!hasAdminKey()) return 0;
  const members = await getDb().select({ userId: organizationMembers.userId }).from(organizationMembers).where(eq(organizationMembers.organizationId, orgId));
  const admin = createSupabaseAdmin();
  let n = 0;
  for (const m of members) {
    try {
      const { data } = await admin.auth.admin.getUserById(m.userId);
      if (data.user?.app_metadata?.organization_id === orgId) {
        await admin.auth.admin.updateUserById(m.userId, { app_metadata: { crm_role: null, organization_id: null } });
        n++;
      }
    } catch (err) {
      console.error(`[lifecycle] no se pudo limpiar un usuario: ${safeError(err)}`);
    }
  }
  return n;
}

/**
 * Exportación de los datos de una inmobiliaria (JSON). Para entregársela al cliente ANTES de eliminar.
 * Contactos, conversaciones con sus mensajes, oportunidades, visitas, propiedades, grupos y etiquetas.
 * Sin credenciales ni datos internos del producto (triaje, puntajes, trabajos).
 */
export async function exportOrganization(orgId: string) {
  const db = getDb();
  const q = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) => db.execute<T>(query);
  const [org] = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug, status: organizations.status }).from(organizations).where(eq(organizations.id, orgId));
  const [contacts, conversations, messages, deals, visits, properties, groups, labels] = await Promise.all([
    q(sql`select c.id, c.name, c.phone, c.email, c.temperature, c.marketing_opt_out_at, c.created_at,
      coalesce((select json_agg(json_build_object('channel', ci.channel, 'external_id', ci.external_id, 'handle', ci.handle)) from contact_identities ci where ci.contact_id = c.id and ci.organization_id = ${orgId}), '[]') as identities
      from contacts c where c.organization_id = ${orgId} order by c.created_at`),
    q(sql`select id, contact_id, channel, participant_name, participant_handle, status, last_message_at, created_at from conversations where organization_id = ${orgId} order by created_at`),
    q(sql`select id, conversation_id, direction, type, body, status, sent_at, raw_payload->>'source' as source from messages where organization_id = ${orgId} order by sent_at`),
    q(sql`select id, contact_id, title, stage, status, value, currency, notes, created_at from deals where organization_id = ${orgId}`),
    q(sql`select id, deal_id, contact_id, property_id, status, scheduled_at, notes, created_at from visits where organization_id = ${orgId}`),
    q(sql`select id, external_id, title, operation, property_type, status, price, currency, zone, city, address_public, bedrooms, bathrooms, area_m2, source_url, created_at from properties where organization_id = ${orgId}`),
    q(sql`select g.id, g.name, g.description, coalesce((select json_agg(gm.contact_id) from contact_group_members gm where gm.group_id = g.id), '[]') as contact_ids from contact_groups g where g.organization_id = ${orgId}`),
    q(sql`select l.id, l.name, coalesce((select json_agg(ll.contact_id) from contact_label_links ll where ll.label_id = l.id), '[]') as contact_ids from contact_labels l where l.organization_id = ${orgId}`),
  ]);
  return { exportedAt: new Date().toISOString(), organization: org ?? null, contacts, conversations, messages, deals, visits, properties, groups, labels };
}
