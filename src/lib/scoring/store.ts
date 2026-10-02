import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  conversations,
  leadPropertyScoreHistory,
  leadPropertyScores,
  networkPropertyListings,
  properties,
  propertyPublications,
  prospectRequirements,
} from "@/db/schema";
import { listNetworkCatalog } from "@/lib/properties/queries";
import { SCORING, bandOf, type Band } from "./config";
import { selectCandidates, type NetworkRow, type OwnRow } from "./candidates";
import { parseManualInput } from "./input";
import {
  CRITERIA_KEYS,
  applyChanges,
  knownCriteria,
  manualChanges,
  profileFromStored,
  type CriterionKey,
  type LeadProfile,
  type StoredCriteria,
} from "./profile";
import { flatFromRow } from "./flat";
import { leadCoverage, scoreCandidate } from "./score";

type Requirement = typeof prospectRequirements.$inferSelect;

const num = (v: string | null) => (v == null ? null : Number(v));

export { flatFromRow };

export const profileFromRow = (r: Requirement): LeadProfile => profileFromStored(flatFromRow(r), r.criteria as StoredCriteria);

/** Perfil vigente del contacto: su fila activa más reciente. Siempre dentro de la organización. */
async function currentRequirement(orgId: string, contactId: string): Promise<Requirement | null> {
  const [row] = await getDb()
    .select()
    .from(prospectRequirements)
    .where(and(eq(prospectRequirements.contactId, contactId), eq(prospectRequirements.organizationId, orgId), eq(prospectRequirements.status, "activo")))
    .orderBy(desc(prospectRequirements.updatedAt))
    .limit(1);
  return row ?? null;
}

async function conversationOf(orgId: string, conversationId: string) {
  const [conv] = await getDb()
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)));
  return conv ?? null;
}

// ── Recalcular y guardar ────────────────────────────────────────────────────

export type RecomputeResult = { stored: number; changed: number };

/**
 * Recalcula los puntajes de UNA conversación y los guarda. El perfil ya está actualizado (lo hizo
 * applyTags o una corrección manual); acá solo se aplica la fórmula, así que es barato y determinista.
 * `changedCriteria` y `triggeringMessageId` quedan en el historial de lo que se movió.
 */
export async function recomputeScores(
  orgId: string,
  conversationId: string,
  opts: { changedCriteria?: string[]; triggeringMessageId?: string | null } = {},
): Promise<RecomputeResult> {
  const db = getDb();
  const conv = await conversationOf(orgId, conversationId);
  if (!conv?.contactId) return { stored: 0, changed: 0 };

  const req = await currentRequirement(orgId, conv.contactId);
  const profile = req ? profileFromRow(req) : null;
  const existing = await db
    .select()
    .from(leadPropertyScores)
    .where(and(eq(leadPropertyScores.conversationId, conversationId), eq(leadPropertyScores.organizationId, orgId)));

  // Sin nada que comparar no se guarda nada (y se limpia lo viejo).
  if (!profile || knownCriteria(profile).length === 0) {
    if (existing.length) await db.delete(leadPropertyScores).where(and(eq(leadPropertyScores.conversationId, conversationId), eq(leadPropertyScores.organizationId, orgId)));
    return { stored: 0, changed: 0 };
  }

  const own = (await db
    .select()
    .from(properties)
    .where(and(eq(properties.organizationId, orgId), inArray(properties.status, ["disponible", "reservada"])))
    .limit(2000)) as OwnRow[];
  const network = (await listNetworkCatalog(orgId, { operation: (profile.operation?.value as never) ?? undefined, limit: 1000 }).catch(() => [])) as NetworkRow[];
  const candidates = selectCandidates(orgId, own, network);

  type Fresh = { c: (typeof candidates)[number]; r: NonNullable<ReturnType<typeof scoreCandidate>> };
  const fresh: Fresh[] = [];
  for (const c of candidates) {
    const r = scoreCandidate(profile, c);
    if (r && r.score >= SCORING.minStoredScore) fresh.push({ c, r });
  }
  const keep: Fresh[] = [];
  for (const kind of ["cartera", "red"] as const) {
    keep.push(...fresh.filter((f) => f.c.kind === kind).sort((a, b) => b.r.score - a.r.score).slice(0, SCORING.maxStoredPerKind));
  }

  const keyOf = (kind: string, id: string) => `${kind}:${id}`;
  const before = new Map(existing.map((e) => [keyOf(e.kind, (e.propertyId ?? e.networkListingId)!), e]));
  const history: (typeof leadPropertyScoreHistory.$inferInsert)[] = [];
  for (const f of keep) {
    const prev = before.get(keyOf(f.c.kind, f.c.id));
    // Solo se anota lo que se MOVIÓ: un recálculo que da lo mismo no escribe historial.
    if (prev && prev.score !== f.r.score) {
      history.push({
        organizationId: orgId,
        conversationId,
        kind: f.c.kind,
        targetId: f.c.id,
        previousScore: prev.score,
        newScore: f.r.score,
        changedCriteria: opts.changedCriteria ?? [],
        triggeringMessageId: opts.triggeringMessageId ?? null,
      });
    }
  }

  const rows = (f: Fresh) => ({
    organizationId: orgId,
    conversationId,
    kind: f.c.kind,
    score: f.r.score,
    confidence: String(f.r.confidence),
    matched: f.r.matched,
    conflicting: f.r.conflicting,
    missing: f.r.missing,
    breakdown: f.r.breakdown as unknown as Record<string, unknown>,
    hardConflicts: f.r.hardConflicts.length,
  });
  const set = (f: Fresh) => ({
    score: f.r.score,
    confidence: String(f.r.confidence),
    matched: f.r.matched,
    conflicting: f.r.conflicting,
    missing: f.r.missing,
    breakdown: f.r.breakdown as unknown as Record<string, unknown>,
    hardConflicts: f.r.hardConflicts.length,
    updatedAt: sql`now()`,
  });

  for (const f of keep.filter((k) => k.c.kind === "cartera")) {
    await db
      .insert(leadPropertyScores)
      .values({ ...rows(f), propertyId: f.c.id })
      .onConflictDoUpdate({ target: [leadPropertyScores.conversationId, leadPropertyScores.propertyId], targetWhere: sql`property_id is not null`, set: set(f) });
  }
  for (const f of keep.filter((k) => k.c.kind === "red")) {
    await db
      .insert(leadPropertyScores)
      .values({ ...rows(f), networkListingId: f.c.id })
      .onConflictDoUpdate({ target: [leadPropertyScores.conversationId, leadPropertyScores.networkListingId], targetWhere: sql`network_listing_id is not null`, set: set(f) });
  }

  // Lo que ya no es candidato (se vendió, cambió la operación…) sale.
  const keepKeys = new Set(keep.map((f) => keyOf(f.c.kind, f.c.id)));
  const stale = existing.filter((e) => !keepKeys.has(keyOf(e.kind, (e.propertyId ?? e.networkListingId)!)));
  if (stale.length) await db.delete(leadPropertyScores).where(inArray(leadPropertyScores.id, stale.map((s) => s.id)));
  if (history.length) await db.insert(leadPropertyScoreHistory).values(history);

  return { stored: keep.length, changed: history.length };
}

// ── Lectura para la pantalla ────────────────────────────────────────────────

export type ProfileRow = {
  key: CriterionKey;
  value: unknown;
  strict: boolean | null;
  confidence: number;
  source: "ai" | "manual";
  messageId: string | null;
  updatedAt: string;
};

export type Recommendation = {
  id: string;
  kind: "cartera" | "red";
  title: string;
  zone: string | null;
  propertyType: string;
  price: number | null;
  currency: string;
  bedrooms: number | null;
  thumb: string | null;
  /** Lo que se carga en la barra de mensaje. Null = no tiene un enlace para mandar. */
  link: string | null;
  score: number;
  band: Band;
  confidence: number;
  matched: string[];
  conflicting: string[];
  missing: string[];
  updatedAt: string;
};

export type Recommendations = {
  profile: ProfileRow[];
  currency: string | null;
  coverage: number;
  cartera: Recommendation[];
  red: Recommendation[];
};

const httpsOnly = (u: string | null | undefined) => (u && u.startsWith("https://") ? u : null);

export async function getRecommendations(orgId: string, conversationId: string, origin: string): Promise<Recommendations> {
  const db = getDb();
  const empty: Recommendations = { profile: [], currency: null, coverage: 0, cartera: [], red: [] };
  const conv = await conversationOf(orgId, conversationId);
  if (!conv?.contactId) return empty;
  const req = await currentRequirement(orgId, conv.contactId);
  if (!req) return empty;

  const profile = profileFromRow(req);
  const known = knownCriteria(profile);
  const profileRows: ProfileRow[] = [...known, ...(profile.budgetFlexible ? (["budgetFlexible"] as const) : [])].map((key) => {
    const c = profile[key]!;
    return { key, value: c.value, strict: c.strict, confidence: c.confidence, source: c.source, messageId: c.messageId, updatedAt: c.updatedAt };
  });
  if (known.length === 0) return { ...empty, profile: profileRows, currency: profile.currency };

  let scores = await db
    .select()
    .from(leadPropertyScores)
    .where(and(eq(leadPropertyScores.conversationId, conversationId), eq(leadPropertyScores.organizationId, orgId)))
    .orderBy(desc(leadPropertyScores.score));
  // Perfil con datos pero nada calculado todavía (conversaciones anteriores a esta función).
  if (scores.length === 0) {
    const r = await recomputeScores(orgId, conversationId);
    if (r.stored > 0) {
      scores = await db
        .select()
        .from(leadPropertyScores)
        .where(and(eq(leadPropertyScores.conversationId, conversationId), eq(leadPropertyScores.organizationId, orgId)))
        .orderBy(desc(leadPropertyScores.score));
    }
  }

  const propIds = scores.map((s) => s.propertyId).filter((x): x is string => Boolean(x));
  const listingIds = scores.map((s) => s.networkListingId).filter((x): x is string => Boolean(x));
  const [props, listings, pubs] = await Promise.all([
    propIds.length ? db.select().from(properties).where(and(inArray(properties.id, propIds), eq(properties.organizationId, orgId))) : [],
    listingIds.length ? db.select().from(networkPropertyListings).where(inArray(networkPropertyListings.id, listingIds)) : [],
    propIds.length
      ? db
          .select({ propertyId: propertyPublications.propertyId, slug: propertyPublications.slug })
          .from(propertyPublications)
          .where(and(eq(propertyPublications.organizationId, orgId), eq(propertyPublications.status, "publicada"), inArray(propertyPublications.propertyId, propIds)))
          .catch(() => [])
      : [],
  ]);
  const propById = new Map(props.map((p) => [p.id, p]));
  const listingById = new Map(listings.map((l) => [l.id, l]));
  const slugOf = new Map(pubs.map((p) => [p.propertyId, p.slug]));

  const out: Recommendations = { profile: profileRows, currency: profile.currency, coverage: leadCoverage(profile).coverage, cartera: [], red: [] };
  for (const s of scores) {
    const base = { score: s.score, band: bandOf(s.score), confidence: Number(s.confidence), matched: s.matched, conflicting: s.conflicting, missing: s.missing, updatedAt: s.updatedAt.toISOString() };
    if (s.kind === "cartera" && s.propertyId) {
      const p = propById.get(s.propertyId);
      if (!p) continue; // salió de la cartera o no es de esta organización
      const slug = slugOf.get(p.id);
      out.cartera.push({
        ...base,
        id: p.id,
        kind: "cartera",
        title: p.title ?? "Sin título",
        zone: p.zone,
        propertyType: p.propertyType,
        price: num(p.price),
        currency: p.currency,
        bedrooms: p.bedrooms,
        thumb: httpsOnly(p.coverUrl ?? p.galleryUrls[0] ?? p.photos[0]),
        // La ficha pública si está publicada; si no, el aviso original.
        link: slug ? `${origin}/p/${slug}` : httpsOnly(p.sourceUrl),
      });
    } else if (s.kind === "red" && s.networkListingId) {
      const l = listingById.get(s.networkListingId);
      if (!l || l.status !== "publicada" || l.ownerOrganizationId === orgId) continue;
      out.red.push({
        ...base,
        id: l.id,
        kind: "red",
        title: l.commercialDescription?.split("\n")[0]?.slice(0, 80) || `${l.propertyType} en ${l.zone ?? l.city ?? "la red"}`,
        zone: l.zone,
        propertyType: l.propertyType,
        price: num(l.price),
        currency: l.currency,
        bedrooms: l.bedrooms,
        thumb: httpsOnly(l.photos[0]),
        link: httpsOnly(l.presentationLink),
      });
    }
  }
  return out;
}

// ── Corrección manual ───────────────────────────────────────────────────────

export type SaveResult = { ok: true; changed: CriterionKey[] } | { ok: false; error: string };

/**
 * Una persona corrige el perfil. Lo manual manda: queda marcado como "manual" y la extracción
 * automática no lo vuelve a pisar. Después se recalculan los puntajes.
 */
export async function saveManualPreferences(orgId: string, conversationId: string, userId: string, body: unknown): Promise<SaveResult> {
  const db = getDb();
  const conv = await conversationOf(orgId, conversationId);
  if (!conv) return { ok: false, error: "No se encontró la conversación." };
  if (!conv.contactId) return { ok: false, error: "Esta conversación todavía no tiene un contacto." };

  const input = parseManualInput(body);
  const changes = manualChanges(input.values, input.strict);
  if (!changes.length && input.currency === undefined) return { ok: false, error: "No hay cambios para guardar." };

  let req = await currentRequirement(orgId, conv.contactId);
  if (!req) {
    [req] = await db
      .insert(prospectRequirements)
      .values({ organizationId: orgId, contactId: conv.contactId, conversationId })
      .returning();
  }

  const now = new Date().toISOString();
  const { criteria, flat, changed } = applyChanges(flatFromRow(req), req.criteria as StoredCriteria, changes, {
    source: "manual",
    messageId: null,
    confidence: SCORING.manualConfidence,
    now,
  });

  const patch: Record<string, unknown> = { ...flat, criteria };
  // Los números van como texto en las columnas numeric.
  for (const col of ["priceMin", "priceMax", "areaMin"] as const) if (col in patch && patch[col] !== null) patch[col] = String(patch[col]);
  if (input.currency !== undefined && input.currency !== null) {
    patch.currency = input.currency;
    patch.rawExtraction = { ...((req.rawExtraction ?? {}) as object), moneda_explicita: true };
  }
  await db
    .update(prospectRequirements)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(prospectRequirements.id, req.id), eq(prospectRequirements.organizationId, orgId)));

  await recomputeScores(orgId, conversationId, { changedCriteria: [...changed, ...(input.currency ? ["currency"] : [])], triggeringMessageId: null });
  return { ok: true, changed };
}

export const __criteriaKeys = CRITERIA_KEYS;
