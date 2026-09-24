import { and, desc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import {
  contacts,
  networkMembers,
  networkPropertyListings,
  propertyMatches,
  propertyPresentations,
} from "@/db/schema";

export type Presentation = typeof propertyPresentations.$inferSelect;

export type CreatePresentationInput = {
  networkPropertyListingId: string;
  prospectContactId: string;
  prospectRequirementId?: string | null;
  matchId?: string | null;
};

export type CreatePresentationResult =
  | { ok: true; presentation: Presentation }
  | { ok: false; error: "listing_not_found" | "not_network_member" | "contact_not_found" };

// Registra que la inmobiliaria `orgId` le presentó una propiedad de red a un prospecto suyo.
// NO notifica al dueño: eso ocurre recién cuando el prospecto pide una visita (requestVisit).
export async function createPresentation(
  orgId: string,
  input: CreatePresentationInput,
): Promise<CreatePresentationResult> {
  const db = getDb();

  const [listing] = await db
    .select({
      id: networkPropertyListings.id,
      networkId: networkPropertyListings.networkId,
      ownerOrganizationId: networkPropertyListings.ownerOrganizationId,
      collaborationTerms: networkPropertyListings.collaborationTerms,
    })
    .from(networkPropertyListings)
    .where(
      and(
        eq(networkPropertyListings.id, input.networkPropertyListingId),
        eq(networkPropertyListings.status, "publicada"),
      ),
    );
  if (!listing) return { ok: false, error: "listing_not_found" };

  const [member] = await db
    .select({ id: networkMembers.id })
    .from(networkMembers)
    .where(
      and(
        eq(networkMembers.networkId, listing.networkId),
        eq(networkMembers.organizationId, orgId),
        eq(networkMembers.status, "activa"),
      ),
    );
  if (!member) return { ok: false, error: "not_network_member" };

  // El prospecto tiene que ser un contacto del tenant que presenta: no se cruza gente entre tenants.
  const [contact] = await db
    .select({ id: contacts.id })
    .from(contacts)
    .where(and(eq(contacts.id, input.prospectContactId), eq(contacts.organizationId, orgId)));
  if (!contact) return { ok: false, error: "contact_not_found" };

  const [presentation] = await db
    .insert(propertyPresentations)
    .values({
      networkId: listing.networkId,
      networkPropertyListingId: listing.id,
      ownerOrganizationId: listing.ownerOrganizationId,
      presentingOrganizationId: orgId,
      prospectContactId: input.prospectContactId,
      prospectRequirementId: input.prospectRequirementId ?? null,
      matchId: input.matchId ?? null,
      status: "presentada",
      commissionTerms: listing.collaborationTerms,
    })
    .returning();

  if (input.matchId) {
    await db
      .update(propertyMatches)
      .set({ status: "presentada" })
      .where(and(eq(propertyMatches.id, input.matchId), eq(propertyMatches.organizationId, orgId)));
  }

  return { ok: true, presentation };
}

// El prospecto pidió visita: recién ACÁ se marca la coordinación con el dueño (owner_notified_at).
// Solo la inmobiliaria que presentó puede dispararlo.
export async function requestVisit(orgId: string, presentationId: string): Promise<Presentation | null> {
  const now = new Date();
  const [row] = await getDb()
    .update(propertyPresentations)
    .set({ status: "visita_solicitada", visitRequestedAt: now, ownerNotifiedAt: now, updatedAt: now })
    .where(
      and(
        eq(propertyPresentations.id, presentationId),
        eq(propertyPresentations.presentingOrganizationId, orgId),
      ),
    )
    .returning();
  return row ?? null;
}

// Cambio de estado (negociando, cerrada_ganada, etc.). Lo pueden hacer las DOS partes.
export async function updatePresentationStatus(
  orgId: string,
  presentationId: string,
  status: Presentation["status"],
): Promise<Presentation | null> {
  const [row] = await getDb()
    .update(propertyPresentations)
    .set({ status, updatedAt: new Date() })
    .where(
      and(
        eq(propertyPresentations.id, presentationId),
        or(
          eq(propertyPresentations.presentingOrganizationId, orgId),
          eq(propertyPresentations.ownerOrganizationId, orgId),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

// Presentaciones visibles para una inmobiliaria: las que aportó (como dueña) y las que hizo
// (como presentadora). Es el punto donde dos tenants comparten estado, nunca datos privados.
export async function listPresentations(orgId: string): Promise<Presentation[]> {
  return getDb()
    .select()
    .from(propertyPresentations)
    .where(
      or(
        eq(propertyPresentations.presentingOrganizationId, orgId),
        eq(propertyPresentations.ownerOrganizationId, orgId),
      ),
    )
    .orderBy(desc(propertyPresentations.presentedAt));
}
