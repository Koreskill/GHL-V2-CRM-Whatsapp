import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { agentConfigs, agentConfigVersions } from "@/db/schema";
import { parseFirstReplies } from "./first-replies";

// Versionado de la configuración del agente. Cada guardado deja una versión inmutable con TODO lo que
// define el comportamiento de ese canal (prompt, modelo, modo de envío, umbrales). Restaurar copia una
// versión vieja sobre la actual, y eso deja a su vez una versión nueva: el historial nunca se reescribe.

const FIELDS = ["enabled", "systemPrompt", "model", "enabledTools", "autoReply", "minConfidence", "humanThreshold", "decisionModel", "firstReplies"] as const;

export async function recordVersion(orgId: string, scope: string, userId: string, note: string | null) {
  const db = getDb();
  const [cfg] = await db.select().from(agentConfigs).where(and(eq(agentConfigs.organizationId, orgId), eq(agentConfigs.scope, scope)));
  if (!cfg) return;
  const snapshot = Object.fromEntries(FIELDS.map((f) => [f, cfg[f] ?? null]));
  // El número sale de la base en la misma sentencia: dos guardados casi simultáneos no repiten versión
  // (el índice único lo garantiza; si chocan, el segundo reintenta una vez).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.execute(sql`
        insert into agent_config_versions (organization_id, scope, version, snapshot, note, created_by)
        select ${orgId}, ${scope}, coalesce(max(version), 0) + 1, ${JSON.stringify(snapshot)}::jsonb, ${note}, ${userId}
        from agent_config_versions where organization_id = ${orgId} and scope = ${scope}
      `);
      return;
    } catch (err) {
      const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
      if (code !== "23505") throw err;
    }
  }
}

export async function listVersions(orgId: string, scope: string, limit = 20) {
  return getDb()
    .select()
    .from(agentConfigVersions)
    .where(and(eq(agentConfigVersions.organizationId, orgId), eq(agentConfigVersions.scope, scope)))
    .orderBy(desc(agentConfigVersions.version))
    .limit(limit);
}

export async function restoreVersion(orgId: string, scope: string, versionId: string, userId: string): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const [v] = await db
    .select()
    .from(agentConfigVersions)
    .where(and(eq(agentConfigVersions.id, versionId), eq(agentConfigVersions.organizationId, orgId), eq(agentConfigVersions.scope, scope)));
  if (!v) return { ok: false, error: "No se encontró la versión." };
  const s = v.snapshot as Record<string, unknown>;
  const str = (k: string) => (typeof s[k] === "string" ? (s[k] as string) : null);
  const values = {
    enabled: s.enabled === true,
    systemPrompt: str("systemPrompt"),
    model: str("model"),
    enabledTools: Array.isArray(s.enabledTools) ? (s.enabledTools as string[]) : [],
    autoReply: str("autoReply"),
    minConfidence: str("minConfidence"),
    humanThreshold: str("humanThreshold"),
    decisionModel: str("decisionModel"),
    // Las versiones anteriores al guion no traen el campo: restaurarlas no debe borrar el que hay hoy.
    ...("firstReplies" in s ? { firstReplies: parseFirstReplies(s.firstReplies) } : {}),
  };
  await db
    .insert(agentConfigs)
    .values({ organizationId: orgId, scope, ...values })
    .onConflictDoUpdate({ target: [agentConfigs.organizationId, agentConfigs.scope], set: { ...values, updatedAt: sql`now()` } });
  await recordVersion(orgId, scope, userId, `Restaurada desde la versión ${v.version}`);
  return { ok: true };
}
