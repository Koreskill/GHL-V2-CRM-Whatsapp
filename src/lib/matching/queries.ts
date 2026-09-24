import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { conversations, messages, prospectRequirements, propertyMatches } from "@/db/schema";
import { aiChatComplete, openrouterConfigured, resolveModel } from "@/lib/ai/openrouter";
import { listNetworkCatalog } from "@/lib/properties/queries";
import { scoreMatch, type MatchCandidate, type MatchRequirement } from "./score";

export type Requirement = typeof prospectRequirements.$inferSelect;
type RequirementInsert = typeof prospectRequirements.$inferInsert;

const num = (v: string | null): number | null => (v == null ? null : Number(v));

function toMatchRequirement(r: Requirement): MatchRequirement {
  return {
    operation: r.operation,
    propertyTypes: r.propertyTypes,
    zones: r.zones,
    bedroomsMin: r.bedroomsMin,
    bathroomsMin: r.bathroomsMin,
    priceMin: num(r.priceMin),
    priceMax: num(r.priceMax),
    areaMin: num(r.areaMin),
    mustHave: r.mustHave,
    niceToHave: r.niceToHave,
  };
}

export async function saveRequirements(
  orgId: string,
  input: Omit<RequirementInsert, "id" | "organizationId" | "createdAt" | "updatedAt">,
): Promise<Requirement> {
  const [row] = await getDb()
    .insert(prospectRequirements)
    .values({ ...input, organizationId: orgId })
    .returning();
  return row;
}

const EXTRACTION_SYSTEM = `Extraés el perfil de búsqueda inmobiliaria de un prospecto a partir de su conversación.
Devolvés SOLO un JSON con estas claves (usá null o [] si no hay dato, no inventes):
{
  "operation": "venta" | "alquiler" | "temporario" | null,
  "propertyTypes": string[]  // de: departamento, casa, ph, terreno, local, oficina, cochera, otro
  "zones": string[],         // barrios o zonas mencionadas
  "bedroomsMin": number | null,
  "bathroomsMin": number | null,
  "priceMin": number | null,
  "priceMax": number | null,
  "currency": "USD" | "ARS" | null,
  "areaMin": number | null,
  "mustHave": string[],      // requisitos excluyentes (ej. cochera, apto credito)
  "niceToHave": string[],    // deseables
  "confidence": number       // 0 a 1, qué tan claro quedó el perfil
}`;

type Extracted = Partial<{
  operation: string;
  propertyTypes: string[];
  zones: string[];
  bedroomsMin: number;
  bathroomsMin: number;
  priceMin: number;
  priceMax: number;
  currency: string;
  areaMin: number;
  mustHave: string[];
  niceToHave: string[];
  confidence: number;
}>;

const OPERATIONS = new Set(["venta", "alquiler", "temporario"]);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);
const dec = (v: unknown): string | null => (typeof v === "number" && Number.isFinite(v) ? String(v) : null);

// Extrae el perfil de la conversación con IA y lo guarda. El perfil NUNCA sale del tenant.
export async function extractRequirements(orgId: string, conversationId: string): Promise<Requirement | null> {
  if (!openrouterConfigured()) return null;
  const db = getDb();
  const [conv] = await db
    .select({ id: conversations.id, contactId: conversations.contactId })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.organizationId, orgId)));
  if (!conv?.contactId) return null;

  const history = await db
    .select({ direction: messages.direction, body: messages.body })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.organizationId, orgId)))
    .orderBy(asc(messages.sentAt))
    .limit(40);
  const transcript = history
    .map((m) => `${m.direction === "inbound" ? "Cliente" : "Asesor"}: ${m.body ?? ""}`)
    .join("\n")
    .slice(0, 8000);

  const modelConfig = await resolveModel(orgId, "extraccion");
  const completion = await aiChatComplete({
    organizationId: orgId,
    fn: "extraccion",
    model: modelConfig.model,
    provider: modelConfig.provider,
    params: modelConfig.params,
    body: {
      messages: [
        { role: "system", content: EXTRACTION_SYSTEM },
        { role: "user", content: transcript || "(sin mensajes)" },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    },
    requestRef: { conversationId },
  });

  let data: Extracted;
  try {
    data = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  } catch {
    return null;
  }

  const operation = typeof data.operation === "string" && OPERATIONS.has(data.operation) ? (data.operation as Requirement["operation"]) : null;
  return saveRequirements(orgId, {
    contactId: conv.contactId,
    conversationId,
    operation,
    propertyTypes: arr(data.propertyTypes),
    zones: arr(data.zones),
    bedroomsMin: int(data.bedroomsMin),
    bathroomsMin: int(data.bathroomsMin),
    priceMin: dec(data.priceMin),
    priceMax: dec(data.priceMax),
    currency: typeof data.currency === "string" ? data.currency : "USD",
    areaMin: dec(data.areaMin),
    mustHave: arr(data.mustHave),
    niceToHave: arr(data.niceToHave),
    rawExtraction: data as Record<string, unknown>,
    confidence: typeof data.confidence === "number" ? String(data.confidence) : null,
  });
}

export type ScoredMatch = {
  listingId: string;
  score: number;
  reasons: { factor: string; peso: number; detalle: string }[];
};

// Cruza el perfil contra el catálogo de red y persiste las coincidencias (score > 0).
export async function runMatching(orgId: string, requirementId: string): Promise<ScoredMatch[]> {
  const db = getDb();
  const [req] = await db
    .select()
    .from(prospectRequirements)
    .where(and(eq(prospectRequirements.id, requirementId), eq(prospectRequirements.organizationId, orgId)));
  if (!req) return [];

  const mReq = toMatchRequirement(req);
  const catalog = await listNetworkCatalog(orgId, { operation: req.operation ?? undefined });

  const scored: ScoredMatch[] = [];
  for (const l of catalog) {
    const candidate: MatchCandidate = {
      operation: l.operation,
      propertyType: l.propertyType,
      price: num(l.price),
      zone: l.zone,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      areaM2: num(l.areaM2),
      features: l.features,
    };
    const { score, reasons, excluded } = scoreMatch(mReq, candidate);
    if (excluded || score <= 0) continue;
    scored.push({ listingId: l.id, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);

  for (const m of scored) {
    await db
      .insert(propertyMatches)
      .values({
        organizationId: orgId,
        prospectRequirementId: requirementId,
        networkPropertyListingId: m.listingId,
        score: String(m.score),
        reasons: m.reasons,
      })
      .onConflictDoUpdate({
        target: [propertyMatches.prospectRequirementId, propertyMatches.networkPropertyListingId],
        set: { score: String(m.score), reasons: m.reasons, status: "sugerida" },
      });
  }
  return scored;
}

export async function listMatches(orgId: string, requirementId: string) {
  return getDb()
    .select()
    .from(propertyMatches)
    .where(and(eq(propertyMatches.organizationId, orgId), eq(propertyMatches.prospectRequirementId, requirementId)))
    .orderBy(desc(propertyMatches.score));
}
