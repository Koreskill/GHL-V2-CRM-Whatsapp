import OpenAI from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
} from "openai/resources/chat/completions";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { aiModelConfigs, aiUsageLogs } from "@/db/schema";
import { safeError } from "@/lib/safe-error";

// OpenRouter es la capa de acceso multi-modelo. Expone una API compatible con OpenAI,
// así que reutilizamos el SDK apuntando su baseURL. Toda llamada a IA pasa por acá:
// nunca directo al proveedor desde la automatización, y siempre se registra en ai_usage_logs.
const BASE_URL = "https://openrouter.ai/api/v1";

export type AiFunction = "conversacional" | "extraccion" | "calificacion" | "fallback";

export function openrouterConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export const DEFAULT_AI_MODEL = () => process.env.OPENROUTER_MODEL || "openai/gpt-4.1-mini";

let client: OpenAI | null = null;
function getClient(): OpenAI | null {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new OpenAI({ apiKey, baseURL: BASE_URL, timeout: 45_000, maxRetries: 1 });
  return client;
}

// Modelo para (org, función): ai_model_configs (por prioridad) -> fallback del canal -> env.
export async function resolveModel(
  orgId: string,
  fn: AiFunction,
  fallbackModel?: string | null,
): Promise<{ provider: string; model: string; params: Record<string, unknown> }> {
  const [row] = await getDb()
    .select()
    .from(aiModelConfigs)
    .where(
      and(
        eq(aiModelConfigs.organizationId, orgId),
        eq(aiModelConfigs.function, fn),
        eq(aiModelConfigs.enabled, true),
      ),
    )
    .orderBy(asc(aiModelConfigs.priority))
    .limit(1);
  if (row) return { provider: row.provider, model: row.model, params: row.params };
  return { provider: "openrouter", model: fallbackModel?.trim() || DEFAULT_AI_MODEL(), params: {} };
}

type ChatBody = Omit<ChatCompletionCreateParamsNonStreaming, "model">;

async function logUsage(o: {
  organizationId: string;
  fn: AiFunction;
  provider: string;
  model: string;
  latencyMs: number;
  status: "ok" | "error" | "timeout";
  usage?: ChatCompletion["usage"] | null;
  error?: string | null;
  requestRef?: Record<string, unknown>;
}) {
  // El logging nunca rompe la respuesta: si falla, se ignora.
  await getDb()
    .insert(aiUsageLogs)
    .values({
      organizationId: o.organizationId,
      function: o.fn,
      provider: o.provider,
      model: o.model,
      promptTokens: o.usage?.prompt_tokens ?? null,
      completionTokens: o.usage?.completion_tokens ?? null,
      totalTokens: o.usage?.total_tokens ?? null,
      latencyMs: o.latencyMs,
      status: o.status,
      error: o.error ?? null,
      requestRef: o.requestRef ?? null,
    })
    .catch(() => {});
}

// Chat completion vía OpenRouter con registro de uso. Tira excepción en error (el llamador la atrapa);
// el uso queda logueado igual, con estado error/timeout.
export async function aiChatComplete(opts: {
  organizationId: string;
  fn: AiFunction;
  model: string;
  provider?: string;
  params?: Record<string, unknown>;
  body: ChatBody;
  requestRef?: Record<string, unknown>;
}): Promise<ChatCompletion> {
  const c = getClient();
  if (!c) throw new Error("OPENROUTER_API_KEY no está configurada");
  const provider = opts.provider ?? "openrouter";
  const started = Date.now();
  try {
    // params (config de la org) pisa los defaults del body (temperature, etc.).
    const completion = await c.chat.completions.create({ model: opts.model, ...opts.body, ...opts.params });
    await logUsage({
      organizationId: opts.organizationId,
      fn: opts.fn,
      provider,
      model: opts.model,
      latencyMs: Date.now() - started,
      status: "ok",
      usage: completion.usage,
      requestRef: opts.requestRef,
    });
    return completion;
  } catch (err) {
    const timeout = err instanceof Error && /timeout|abort/i.test(err.message);
    await logUsage({
      organizationId: opts.organizationId,
      fn: opts.fn,
      provider,
      model: opts.model,
      latencyMs: Date.now() - started,
      status: timeout ? "timeout" : "error",
      error: safeError(err),
      requestRef: opts.requestRef,
    });
    throw err;
  }
}
