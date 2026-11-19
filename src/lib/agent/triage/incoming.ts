import type { Derivation } from "@/lib/inbox/derivations";
import { derivedForPrompt, MEDIA_ACK_OBJECT, MEDIA_LABEL, MEDIA_WITH_ARTICLE, READABLE_KINDS, type Attachment, type MediaKind } from "@/lib/inbox/media";

/**
 * Qué se le pasa al agente cuando el mensaje de la persona no es (solo) texto. Lógica pura.
 *
 * Regla de fondo: un mensaje con un adjunto NUNCA queda sin atender. O se pudo leer y entra al triaje como
 * texto (marcado como lectura automática), o no se pudo y queda para una persona, avisando en la campanita.
 */

export type IncomingPlan =
  | { kind: "text"; text: string; transcript: string | null }
  | {
      kind: "unusable";
      /** Qué mandó la persona (el medio principal). */
      media: MediaKind;
      /** Era un medio que el sistema sabe leer pero no pudo (a diferencia de un video, que no lee). */
      failed: boolean;
      /** El archivo llegó bien pero no tiene nada interpretable (audio sin voz, imagen en blanco). No es una falla técnica. */
      unreadable: boolean;
      error: string | null;
    };

/**
 * @param caption  Texto que acompaña al mensaje (el pie de una foto), si hay.
 * @param media    Adjuntos del mensaje.
 * @param read     Resultado de leer el primer medio legible; null si no había uno o no se intentó.
 */
export function planIncoming(input: { caption: string; media: Attachment[]; read: Derivation | null }): IncomingPlan {
  const { caption, media, read } = input;
  const readable = media.find((a) => READABLE_KINDS.includes(a.kind)) ?? null;
  const parts: string[] = [];
  if (caption) parts.push(caption);
  if (read?.ok) parts.push(derivedForPrompt(read.kind, read.text));

  if (parts.length === 0) {
    const main = readable ?? media[0];
    return {
      kind: "unusable",
      media: main?.kind ?? "unknown",
      failed: Boolean(readable),
      unreadable: read && !read.ok ? read.unreadable : false,
      error: read && !read.ok ? read.error : null,
    };
  }

  // Hay texto utilizable. Lo que no se pudo leer se aclara, para que el agente no finja haberlo visto.
  for (const a of media) {
    if (a.kind === "sticker") continue;
    const wasRead = a === readable && read?.ok;
    if (!wasRead) parts.push(`[Adjunto que el sistema no pudo leer: ${MEDIA_LABEL[a.kind]}]`);
  }
  return { kind: "text", text: parts.join("\n"), transcript: read?.ok && read.kind === "transcripcion" ? read.text : null };
}

/** Motivo que ve el equipo en la campanita. */
export function unusableReason(p: Extract<IncomingPlan, { kind: "unusable" }>): string {
  const what = MEDIA_WITH_ARTICLE[p.media];
  if (p.failed && p.unreadable) return `Mandó ${what} y no se pudo interpretar (${p.error ?? "sin detalle"}): lo tiene que ver una persona`;
  if (p.failed) return `Mandó ${what} y el sistema no lo pudo leer (${p.error ?? "sin detalle"}): lo tiene que ver una persona`;
  return `Mandó ${what}, que el sistema no lee solo: lo tiene que ver una persona`;
}

/**
 * Acuse fijo a la persona. Sin plazos ni promesas de solución, igual que el resto de los acuses.
 * Null = no corresponde mandar nada (un sticker no es una consulta; un contenido compartido, tampoco).
 */
export function unusableAck(media: MediaKind): string | null {
  if (media === "sticker" || media === "share") return null;
  return `Recibimos ${MEDIA_ACK_OBJECT[media]}. Una persona del equipo lo va a revisar.`;
}
