import { and, eq, inArray } from "drizzle-orm";
import type { DbExecutor as Db } from "@/db";
import { contactIdentities, contacts, type Channel } from "@/db/schema";

export type IdentityInput = {
  channel: Channel;
  // En orden de preferencia: el primero es el ancla canónica (p. ej. BSUID en WhatsApp).
  externalIds: string[];
  handle?: string | null;
  name?: string | null;
  phone?: string | null;
};

// Resuelve el contacto por (channel, external_id); nunca por teléfono.
export async function resolveContact(db: Db, input: IdentityInput): Promise<string> {
  const ids = [...new Set(input.externalIds.filter(Boolean))];
  if (ids.length === 0) throw new Error("resolveContact: sin external_id");

  const existing = await db
    .select({ contactId: contactIdentities.contactId, externalId: contactIdentities.externalId })
    .from(contactIdentities)
    .where(and(eq(contactIdentities.channel, input.channel), inArray(contactIdentities.externalId, ids)));

  let contactId = existing[0]?.contactId;
  if (!contactId) {
    const [created] = await db
      .insert(contacts)
      .values({ name: input.name ?? null, phone: input.phone ?? null })
      .returning({ id: contacts.id });
    contactId = created.id;
  }

  const known = new Set(existing.map((e) => e.externalId));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) {
    await db
      .insert(contactIdentities)
      .values(missing.map((externalId) => ({ contactId: contactId!, channel: input.channel, externalId, handle: input.handle ?? null })))
      .onConflictDoNothing();

    // Si dos entregas concurrentes crearon contactos a la vez, gana la identidad que quedó en la tabla.
    const [winner] = await db
      .select({ contactId: contactIdentities.contactId })
      .from(contactIdentities)
      .where(and(eq(contactIdentities.channel, input.channel), eq(contactIdentities.externalId, ids[0])));
    if (winner && winner.contactId !== contactId) {
      if (existing.length === 0) await db.delete(contacts).where(eq(contacts.id, contactId));
      contactId = winner.contactId;
    }
  }

  return contactId;
}
