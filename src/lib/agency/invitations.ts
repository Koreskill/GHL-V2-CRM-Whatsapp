import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { invitations, organizationMembers } from "@/db/schema";
import type { Role } from "@/lib/roles";
import { activeOrganizationOf } from "@/lib/agency/users";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

const TTL_MS = 7 * 24 * 3600_000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

/** Crea la invitación y devuelve el token CRUDO: se muestra una sola vez, en la base queda su hash. */
export async function createInvitation(input: { organizationId: string; email: string; role: Role; invitedBy: string }) {
  const token = randomBytes(32).toString("base64url");
  const db = getDb();
  const email = normalizeEmail(input.email);
  // Una invitación vigente por email y organización: invitar de nuevo revoca la anterior.
  await db
    .update(invitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(invitations.organizationId, input.organizationId), eq(invitations.email, email), eq(invitations.status, "pending")));
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db.insert(invitations).values({
    organizationId: input.organizationId,
    email,
    role: input.role === "admin" ? "admin" : "agente",
    tokenHash: hashToken(token),
    expiresAt,
    invitedBy: input.invitedBy,
  });
  return { token, expiresAt };
}

export async function listPendingInvitations(organizationId?: string) {
  const rows = await getDb()
    .select()
    .from(invitations)
    .where(
      organizationId
        ? and(eq(invitations.status, "pending"), eq(invitations.organizationId, organizationId))
        : eq(invitations.status, "pending"),
    )
    .orderBy(desc(invitations.createdAt))
    .limit(100);
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    organizationId: r.organizationId,
    email: r.email,
    role: r.role,
    expiresAt: r.expiresAt.toISOString(),
    expired: r.expiresAt.getTime() < now,
  }));
}

export async function revokeInvitation(id: string) {
  await getDb()
    .update(invitations)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(and(eq(invitations.id, id), eq(invitations.status, "pending")));
}

export type AcceptResult =
  | { ok: true }
  | { ok: false; reason: "invalida" | "vencida" | "otro_email" | "email_no_verificado" | "otra_inmobiliaria" | "error" };

/**
 * Canjea una invitación. El token se consume UNA vez (UPDATE ... WHERE status = 'pending' RETURNING) y
 * solo lo puede usar la cuenta cuyo email VERIFICADO coincide con el invitado: un enlace reenviado no sirve.
 */
export async function acceptInvitation(
  token: string,
  user: { id: string; email?: string | null; email_confirmed_at?: string | null },
): Promise<AcceptResult> {
  const db = getDb();
  const [inv] = await db.select().from(invitations).where(eq(invitations.tokenHash, hashToken(token)));
  if (!inv || inv.status !== "pending") return { ok: false, reason: "invalida" };
  if (inv.expiresAt.getTime() < Date.now()) return { ok: false, reason: "vencida" };
  if (!user.email_confirmed_at) return { ok: false, reason: "email_no_verificado" };
  if (!user.email || normalizeEmail(user.email) !== inv.email) return { ok: false, reason: "otro_email" };

  // Antes de consumir el enlace: una cuenta con otra inmobiliaria no se muda en silencio.
  const current = await activeOrganizationOf(user.id);
  if (current.error) return { ok: false, reason: "error" };
  if (current.orgId && current.orgId !== inv.organizationId) return { ok: false, reason: "otra_inmobiliaria" };

  const [claimed] = await db
    .update(invitations)
    .set({ status: "accepted", acceptedBy: user.id, acceptedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invitations.id, inv.id), eq(invitations.status, "pending")))
    .returning({ id: invitations.id });
  if (!claimed) return { ok: false, reason: "invalida" };

  const role: Role = inv.role === "admin" ? "admin" : "agent";
  const { error } = await createSupabaseAdmin().auth.admin.updateUserById(user.id, {
    app_metadata: { crm_role: role, organization_id: inv.organizationId },
  });
  if (error) {
    // No quedó habilitado: se devuelve la invitación para poder reintentar.
    await db.update(invitations).set({ status: "pending", acceptedBy: null, acceptedAt: null }).where(eq(invitations.id, inv.id));
    return { ok: false, reason: "error" };
  }
  await db
    .insert(organizationMembers)
    .values({ userId: user.id, organizationId: inv.organizationId, role: inv.role, status: "active" })
    .onConflictDoUpdate({
      target: [organizationMembers.userId, organizationMembers.organizationId],
      set: { role: inv.role, status: "active", updatedAt: new Date() },
    });
  return { ok: true };
}
