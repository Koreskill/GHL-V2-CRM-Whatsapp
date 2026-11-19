import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { messageDerivations, messages } from "@/db/schema";
import { describeImage, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, transcribeAudio } from "@/lib/ai/media";
import { attachmentsFromPayload, READABLE_KINDS, type Attachment } from "./media";
import { loadMedia } from "./media-store";

/**
 * Lo que un modelo leyó de un medio entrante, guardado en `message_derivations` (migración 0026).
 *
 * - El original no se toca: sigue en `messages.raw_payload`.
 * - Se guardan las lecturas buenas y las "no se entiende nada" (para no pagar dos veces el mismo archivo).
 *   Un fallo de red o del modelo NO se guarda: el próximo intento lo vuelve a probar.
 * - Nada acá tira una excepción hacia el triaje: devuelve el resultado o el motivo.
 */

export type DerivationKind = "transcripcion" | "descripcion_imagen";

export type Derivation =
  | { ok: true; kind: DerivationKind; text: string; model: string | null }
  // unreadable: el archivo llegó bien pero no tiene nada interpretable (no es una falla del sistema).
  | { ok: false; kind: DerivationKind; error: string; unreadable: boolean };

const KIND_OF: Record<string, DerivationKind> = { audio: "transcripcion", image: "descripcion_imagen" };

/** El primer adjunto que un modelo puede leer. */
export function firstReadable(rawPayload: unknown): Attachment | null {
  return attachmentsFromPayload(rawPayload).find((a) => READABLE_KINDS.includes(a.kind)) ?? null;
}

/** Lecturas ya guardadas de estos mensajes (solo las buenas), por id de mensaje. */
export async function loadDerivations(organizationId: string, messageIds: string[]) {
  const out = new Map<string, { kind: DerivationKind; text: string; model: string | null }>();
  if (!messageIds.length) return out;
  const rows = await getDb()
    .select()
    .from(messageDerivations)
    .where(
      and(
        eq(messageDerivations.organizationId, organizationId),
        inArray(messageDerivations.messageId, messageIds),
        eq(messageDerivations.status, "ok"),
      ),
    );
  for (const r of rows) if (r.text) out.set(r.messageId, { kind: r.kind as DerivationKind, text: r.text, model: r.model });
  return out;
}

/**
 * Lee el medio de UN mensaje (si no está ya leído). Devuelve null si el mensaje no trae un medio legible.
 * Corre dentro del trabajo del triaje, nunca en el webhook.
 */
export async function deriveMessage(input: {
  organizationId: string;
  conversationId: string;
  messageId: string;
  rawPayload: unknown;
}): Promise<Derivation | null> {
  const attachment = firstReadable(input.rawPayload);
  if (!attachment) return null;
  const kind = KIND_OF[attachment.kind];
  const db = getDb();

  const [existing] = await db
    .select()
    .from(messageDerivations)
    .where(and(eq(messageDerivations.messageId, input.messageId), eq(messageDerivations.organizationId, input.organizationId)));
  if (existing) {
    return existing.status === "ok" && existing.text
      ? { ok: true, kind, text: existing.text, model: existing.model }
      : { ok: false, kind, error: existing.error ?? "No se pudo leer el medio", unreadable: true };
  }

  const file = await loadMedia(input.organizationId, input.messageId, attachment, attachment.kind === "audio" ? MAX_AUDIO_BYTES : MAX_IMAGE_BYTES);
  if (!file.ok) return { ok: false, kind, error: `No se pudo descargar el ${attachment.kind === "audio" ? "audio" : "archivo"}: ${file.error}`, unreadable: false };

  const ctx = { organizationId: input.organizationId, conversationId: input.conversationId, messageId: input.messageId };
  const mime = attachment.mime ?? file.contentType;
  const result =
    attachment.kind === "audio" ? await transcribeAudio(ctx, { bytes: file.bytes, mime }) : await describeImage(ctx, { bytes: file.bytes, mime });

  if (result.ok) {
    await db
      .insert(messageDerivations)
      .values({ organizationId: input.organizationId, messageId: input.messageId, kind, status: "ok", text: result.text, model: result.model })
      .onConflictDoNothing({ target: messageDerivations.messageId })
      .catch(() => {});
    return { ok: true, kind, text: result.text, model: result.model };
  }
  if (result.permanent) {
    await db
      .insert(messageDerivations)
      .values({ organizationId: input.organizationId, messageId: input.messageId, kind, status: "error", error: result.error, model: result.model })
      .onConflictDoNothing({ target: messageDerivations.messageId })
      .catch(() => {});
  }
  return { ok: false, kind, error: result.error, unreadable: Boolean(result.permanent) };
}

/**
 * Lee los medios de mensajes ANTERIORES del mismo hilo que todavía no se leyeron. Una ráfaga ("audio" + "texto")
 * genera un trabajo por mensaje, pero solo contesta el último: sin esto, el audio del medio quedaría como
 * "[audio]" en lo que ve el agente. Tope bajo: no es una forma de gastar sin límite.
 */
export async function deriveEarlierMedia(input: { organizationId: string; conversationId: string; exceptMessageId: string; limit?: number }) {
  const rows = await getDb()
    .select({ id: messages.id, rawPayload: messages.rawPayload })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, input.conversationId),
        eq(messages.organizationId, input.organizationId),
        eq(messages.direction, "inbound"),
        inArray(messages.type, ["audio", "image", "voice", "ptt", "photo"]),
        sql`${messages.id} <> ${input.exceptMessageId}`,
        sql`not exists (select 1 from message_derivations d where d.message_id = ${messages.id})`,
        sql`${messages.sentAt} >= now() - interval '2 hours'`,
      ),
    )
    .orderBy(desc(messages.sentAt))
    .limit(input.limit ?? 3);
  for (const row of rows) {
    await deriveMessage({ organizationId: input.organizationId, conversationId: input.conversationId, messageId: row.id, rawPayload: row.rawPayload }).catch(() => null);
  }
}
