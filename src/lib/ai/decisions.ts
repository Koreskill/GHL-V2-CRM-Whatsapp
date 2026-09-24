import { getDb } from "@/db";
import { aiUsageLogs } from "@/db/schema";
import { safeError } from "@/lib/safe-error";
import type { AiFunction } from "./openrouter";

/**
 * Decisions API de OpenRouter (System One / Jev).
 *
 * Es un endpoint APARTE del de chat: `POST /api/alpha/decisions`, no `/v1/chat/completions`,
 * así que no se puede usar el SDK de OpenAI. Va con fetch nativo, como el cliente de Zernio.
 *
 * Los tipos están escritos contra `openapi/openrouter-decisions.yaml`, descargado de la
 * documentación oficial. No inventar campos: si algo no está en ese archivo, no existe.
 *
 * Jev devuelve respuestas TIPADAS con probabilidades, no texto. No redacta: solo decide.
 */

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

// ─── Preguntas ──────────────────────────────────────────────────────────────
// Tres primitivas. `instructions` y `criteria` admiten string u objeto; acá se usan strings,
// que es lo que se lee bien cuando alguien revisa por qué clasificó de una manera.

/** "¿Se cumple esta condición?" Devuelve la probabilidad de que sí. */
export type NoulQuestion = {
  type: "noul";
  instructions: string;
  criteria: { true: string; false: string };
};

/** "¿Cuál de estas opciones?" Devuelve la elegida, su probabilidad y una confianza. */
export type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

/** "¿Dónde cae en una escala ordenada?" El ORDEN del array importa: de menor a mayor. */
export type ScoreQuestion = {
  type: "score";
  instructions: string;
  criteria: string[];
};

export type DecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

// ─── Respuestas ─────────────────────────────────────────────────────────────
// Ojo: según el OpenAPI, `noul` NO trae confidence. Solo `choice` y `score` la tienen.

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  confidence?: number;
  probabilities?: Record<string, number>;
};
export type ScoreAnswer = {
  type: "score";
  /** Posición ponderada por probabilidad, NO un entero: con 3 niveles puede dar 1.99. */
  score: number;
  confidence?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
};

export type DecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type DecisionsResponse = {
  id?: string;
  model: string;
  provider?: string;
  answers: Record<string, DecisionAnswer>;
  // La Decisions API cuenta input/output, no prompt/completion como el chat.
  usage: { input_tokens: number; output_tokens: number; cost?: number };
};

export type DecisionsResult =
  | { success: true; data: DecisionsResponse }
  | { success: false; error: string };

const TIMEOUT_MS = 30_000;

/**
 * Pide una decisión y registra el uso, igual que `aiChatComplete`.
 * Nunca tira excepción: devuelve `{ success }`, como el cliente de Zernio.
 */
export async function aiDecide(opts: {
  organizationId: string;
  fn: AiFunction;
  model: string;
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  /** Agrupa las llamadas de una misma conversación en la observabilidad de OpenRouter. */
  sessionId?: string;
  requestRef?: Record<string, unknown>;
}): Promise<DecisionsResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { success: false, error: "OPENROUTER_API_KEY no está configurada" };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const log = (status: "ok" | "error" | "timeout", data?: DecisionsResponse, error?: string) =>
    getDb()
      .insert(aiUsageLogs)
      .values({
        organizationId: opts.organizationId,
        function: opts.fn,
        provider: "openrouter",
        model: opts.model,
        promptTokens: data?.usage.input_tokens ?? null,
        completionTokens: data?.usage.output_tokens ?? null,
        totalTokens: data ? data.usage.input_tokens + data.usage.output_tokens : null,
        costUsd: data?.usage.cost !== undefined ? String(data.usage.cost) : null,
        latencyMs: Date.now() - started,
        status,
        error: error ?? null,
        requestRef: opts.requestRef ?? null,
      })
      // Que falle el registro no puede tumbar la clasificación.
      .catch(() => {});

  try {
    const res = await fetch(DECISIONS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        state: opts.state,
        questions: opts.questions,
        ...(opts.sessionId ? { session_id: opts.sessionId.slice(0, 256) } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // El cuerpo del error puede traer de vuelta el `state`, que lleva datos del contacto:
      // se guarda solo el código, nunca la respuesta entera.
      const error = `La Decisions API respondió ${res.status}`;
      await log("error", undefined, error);
      return { success: false, error };
    }

    const data = (await res.json()) as DecisionsResponse;
    if (!data?.answers || typeof data.answers !== "object") {
      const error = "La Decisions API devolvió una respuesta sin answers";
      await log("error", undefined, error);
      return { success: false, error };
    }

    await log("ok", data);
    return { success: true, data };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    const error = aborted ? "La Decisions API tardó demasiado" : safeError(err);
    await log(aborted ? "timeout" : "error", undefined, error);
    return { success: false, error };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Lectura segura de las respuestas ───────────────────────────────────────
// Jev responde lo que se le preguntó, pero una respuesta remota se valida igual antes de usarla.

export function readNoul(answer: DecisionAnswer | undefined): number | null {
  return answer?.type === "noul" && Number.isFinite(answer.noul) ? answer.noul : null;
}

export function readChoice<T extends string>(
  answer: DecisionAnswer | undefined,
  allowed: readonly T[],
): { choice: T; confidence: number; probabilities: Record<string, number> } | null {
  if (answer?.type !== "choice") return null;
  // Si devolviera una opción fuera del catálogo, se descarta: no se enruta a ciegas.
  if (!(allowed as readonly string[]).includes(answer.choice)) return null;
  return {
    choice: answer.choice as T,
    // Sin confidence se asume 0: obliga a pasar por revisión humana en vez de dar por buena la decisión.
    confidence: Number.isFinite(answer.confidence) ? (answer.confidence as number) : 0,
    probabilities: answer.probabilities ?? {},
  };
}

/**
 * Convierte un score a su nivel entero (0..n-1).
 * `score` viene ponderado por probabilidad (1.99 con tres niveles), así que se redondea.
 */
export function readScore(
  answer: DecisionAnswer | undefined,
  levels: number,
): { level: number; confidence: number; probabilities: Record<string, number> } | null {
  if (answer?.type !== "score" || !Number.isFinite(answer.score)) return null;
  const level = Math.min(levels - 1, Math.max(0, Math.round(answer.score)));
  return {
    level,
    confidence: Number.isFinite(answer.confidence) ? (answer.confidence as number) : 0,
    probabilities: answer.probabilities ?? {},
  };
}
