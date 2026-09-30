"use server";

import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { agentConfigs, organizations } from "@/db/schema";
import { DEAL_STAGES } from "@/lib/pipeline";
import { isPresetId } from "@/lib/pipeline-colors";
import { TOOL_NAMES } from "@/lib/agent/tools";
import { requireRole } from "@/lib/auth";

const SCOPES = new Set(["global", "whatsapp", "instagram", "facebook"]);
// Slugs de OpenRouter llevan barra (proveedor/modelo), p. ej. openai/gpt-4.1-mini.
const MODEL_RE = /^[a-zA-Z0-9._:/-]{1,80}$/;

export async function saveAgentConfig(formData: FormData) {
  const session = await requireRole("admin");
  if (!session) redirect("/");

  const scope = String(formData.get("scope") ?? "");
  if (!SCOPES.has(scope)) throw new Error("Pestaña inválida");

  const prompt = String(formData.get("systemPrompt") ?? "").trim().slice(0, 20_000);
  const modelRaw = String(formData.get("model") ?? "").trim();
  const model = modelRaw && MODEL_RE.test(modelRaw) ? modelRaw : null;
  const tools = formData.getAll("tools").map(String).filter((t) => (TOOL_NAMES as readonly string[]).includes(t));
  // `global` no tiene interruptor propio: cada canal se prende o apaga por separado.
  const enabled = scope === "global" ? true : formData.get("enabled") === "on";

  // Política de respuesta automática. Null = hereda de global; el 0 es un valor válido y no se
  // puede confundir con "vacío", así que se compara contra cadena vacía, no con truthiness.
  const AUTO_REPLY = new Set(["auto", "borrador", "off"]);
  const autoReplyRaw = String(formData.get("autoReply") ?? "").trim();
  const autoReply = AUTO_REPLY.has(autoReplyRaw) ? autoReplyRaw : null;

  const ratio = (key: string): string | null => {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    if (raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? String(n) : null;
  };
  const minConfidence = ratio("minConfidence");
  const humanThreshold = ratio("humanThreshold");
  const decisionModelRaw = String(formData.get("decisionModel") ?? "").trim();
  const decisionModel = decisionModelRaw && MODEL_RE.test(decisionModelRaw) ? decisionModelRaw : null;

  await getDb()
    .insert(agentConfigs)
    .values({
      organizationId: session.organizationId,
      scope,
      enabled,
      systemPrompt: prompt || null,
      model,
      enabledTools: tools,
      autoReply,
      minConfidence,
      humanThreshold,
      decisionModel,
    })
    .onConflictDoUpdate({
      target: [agentConfigs.organizationId, agentConfigs.scope],
      set: {
        enabled,
        systemPrompt: prompt || null,
        model,
        enabledTools: tools,
        autoReply,
        minConfidence,
        humanThreshold,
        decisionModel,
        updatedAt: sql`now()`,
      },
    });

  revalidatePath("/configuracion");
  redirect(`/configuracion?tab=${scope}&saved=1`);
}

// Colores de las columnas del pipeline: una preferencia de la inmobiliaria, guardada en
// organizations.metadata. Solo se aceptan ids de la paleta; el orden y los ids de las etapas no cambian.
export async function savePipelineColors(formData: FormData) {
  const session = await requireRole("admin");
  if (!session) redirect("/");

  const colors: Record<string, string> = {};
  for (const stage of DEAL_STAGES) {
    const value = formData.get(`color_${stage.id}`);
    if (isPresetId(value)) colors[stage.id] = value;
  }

  await getDb()
    .update(organizations)
    .set({ metadata: sql`coalesce(${organizations.metadata}, '{}'::jsonb) || ${JSON.stringify({ pipelineColors: colors })}::jsonb`, updatedAt: sql`now()` })
    .where(eq(organizations.id, session.organizationId));

  revalidatePath("/pipeline");
  redirect("/configuracion?tab=pipeline&saved=1");
}
