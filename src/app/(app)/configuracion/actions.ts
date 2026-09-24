"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { agentConfigs } from "@/db/schema";
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

  await getDb()
    .insert(agentConfigs)
    .values({ organizationId: session.organizationId, scope, enabled, systemPrompt: prompt || null, model, enabledTools: tools })
    .onConflictDoUpdate({
      target: [agentConfigs.organizationId, agentConfigs.scope],
      set: { enabled, systemPrompt: prompt || null, model, enabledTools: tools, updatedAt: sql`now()` },
    });

  revalidatePath("/configuracion");
  redirect(`/configuracion?tab=${scope}&saved=1`);
}
