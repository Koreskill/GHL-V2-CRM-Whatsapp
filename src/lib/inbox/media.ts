/**
 * Medios de un mensaje (audio, imagen, video, archivo…). Lógica pura, sin base ni red.
 *
 * Zernio entrega los adjuntos dentro del payload del webhook (`message.attachments`), que `ingest.ts`
 * guarda tal cual en `messages.raw_payload`. Acá se LEEN. Dos cosas que conviene tener presentes:
 *
 *  - La URL de un adjunto entrante de WhatsApp apunta a `GET /v1/whatsapp/media/{mediaId}` de Zernio y
 *    exige `Authorization: Bearer <ZERNIO_API_KEY>`: el navegador no la puede abrir. Por eso el CRM sirve
 *    los medios por su propia ruta (`/api/messages/[id]/media`), que descarga con la clave del servidor.
 *  - Esa clave NUNCA se manda a otro host. `mediaFetchPlan` decide a qué hosts se puede ir y con qué.
 */

export type MediaKind = "audio" | "image" | "video" | "file" | "sticker" | "share" | "unknown";

export type Attachment = {
  /** Posición dentro del mensaje: es lo que viaja en `?i=` a la ruta de medios. */
  index: number;
  kind: MediaKind;
  /** Solo https. Null si la URL no es válida: el adjunto se muestra como "no disponible". */
  url: string | null;
  mime: string | null;
  name: string | null;
};

const KINDS: Record<string, MediaKind> = {
  audio: "audio",
  voice: "audio",
  ptt: "audio",
  image: "image",
  photo: "image",
  video: "video",
  file: "file",
  document: "file",
  sticker: "sticker",
  share: "share",
};

export function kindOfType(type: unknown): MediaKind {
  return typeof type === "string" ? (KINDS[type.trim().toLowerCase()] ?? "unknown") : "unknown";
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

/** Una URL de un tercero que el servidor va a pedir o el navegador a mostrar: solo https, sin credenciales. */
export function httpsMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Adjuntos de un `raw_payload`. Acepta el payload completo del webhook (`{ message: { attachments } }`) o
 * un mensaje suelto (`{ attachments }`). Cualquier otra forma, o un mensaje importado, da lista vacía.
 */
export function attachmentsFromPayload(raw: unknown): Attachment[] {
  const root = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const message = root?.message && typeof root.message === "object" ? (root.message as Record<string, unknown>) : root;
  const list = message?.attachments;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map((item, index) => {
    const a = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const meta = a.payload && typeof a.payload === "object" ? (a.payload as Record<string, unknown>) : {};
    return {
      index,
      kind: kindOfType(a.type),
      url: httpsMediaUrl(a.url),
      mime: str(meta.mime_type ?? meta.mimeType ?? meta.mimetype ?? meta.contentType, 100),
      name: str(meta.filename ?? meta.fileName ?? meta.name ?? a.name, 200),
    };
  });
}

/** Cómo se nombra cada medio en la interfaz y en los avisos al equipo. */
export const MEDIA_LABEL: Record<MediaKind, string> = {
  audio: "audio",
  image: "imagen",
  video: "video",
  file: "archivo",
  sticker: "sticker",
  share: "contenido compartido",
  unknown: "adjunto",
};

/** "un audio", "una imagen"…: para escribirle al equipo qué mandó la persona. */
export const MEDIA_WITH_ARTICLE: Record<MediaKind, string> = {
  audio: "un audio",
  image: "una imagen",
  video: "un video",
  file: "un archivo",
  sticker: "un sticker",
  share: "un contenido compartido",
  unknown: "un adjunto",
};

/** Cómo lo nombra el acuse a la persona ("Recibimos tu audio"). Sin plazos ni promesas de resolución. */
export const MEDIA_ACK_OBJECT: Record<MediaKind, string> = {
  audio: "tu audio",
  image: "tu imagen",
  video: "tu video",
  file: "tu archivo",
  sticker: "tu mensaje",
  share: "tu mensaje",
  unknown: "tu mensaje",
};

/** Adjuntos que se copian a Storage al llegar (media-store.ts). Un sticker o un contenido compartido no se guardan. */
export const isStorable = (a: Attachment) => a.url !== null && a.kind !== "sticker" && a.kind !== "share";

/** Medios que un modelo puede leer hoy. El resto se deriva a una persona. */
export const READABLE_KINDS: readonly MediaKind[] = ["audio", "image"];

// ─── Descarga segura ────────────────────────────────────────────────────────

/** Host de la API de Zernio: el único al que se le manda la clave. */
export const ZERNIO_MEDIA_HOST = "zernio.com";

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  // IPv6 literal o IPv4 literal: no hay razón para que un medio venga de una IP pelada.
  if (h.includes(":")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // Un host sin punto (nombre interno de la red del servidor).
  return !h.includes(".");
}

export type MediaFetchPlan = { ok: true; url: string; withAuth: boolean } | { ok: false; reason: string };

/**
 * A qué URL se puede ir a buscar un medio y si lleva la clave de Zernio.
 * - https obligatorio; sin IPs, localhost ni nombres internos (el servidor no puede ser usado para mirar
 *   la red de adentro).
 * - La clave solo viaja al host de Zernio (y a ningún otro, tampoco tras una redirección).
 */
export function mediaFetchPlan(url: string | null): MediaFetchPlan {
  const safe = httpsMediaUrl(url);
  if (!safe) return { ok: false, reason: "URL no válida" };
  const host = new URL(safe).hostname.toLowerCase();
  if (isPrivateHost(host)) return { ok: false, reason: "Host no permitido" };
  return { ok: true, url: safe, withAuth: host === ZERNIO_MEDIA_HOST };
}

// ─── Lo que se le pide a los modelos ────────────────────────────────────────

/** Formato de audio que se le declara al modelo. WhatsApp manda las notas de voz en Ogg/Opus. */
export function audioFormatFor(mime: string | null): string {
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (m === "audio/mpeg" || m === "audio/mp3") return "mp3";
  if (m === "audio/wav" || m === "audio/x-wav" || m === "audio/wave") return "wav";
  if (m === "audio/aac") return "aac";
  if (m === "audio/mp4" || m === "audio/m4a" || m === "audio/x-m4a") return "m4a";
  if (m === "audio/flac") return "flac";
  return "ogg";
}

/** MIME de una imagen para armar el data URL. Solo los formatos que los modelos aceptan; null = no se lee. */
export function imageMimeFor(mime: string | null, bytes?: Uint8Array): string | null {
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (m === "image/jpeg" || m === "image/jpg") return "image/jpeg";
  if (m === "image/png" || m === "image/webp" || m === "image/gif") return m;
  // Sin tipo confiable: se mira la firma del archivo.
  if (bytes && bytes.length > 12) {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57) return "image/webp";
  }
  return null;
}

const TRANSCRIPT_MAX = 2000;
const DESCRIPTION_MAX = 800;

function stripFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

/** Limpia lo que devolvió el modelo al transcribir. Null = no se entendió nada. */
export function cleanTranscript(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = stripFences(raw).replace(/^["“«]+|["”»]+$/g, "").trim();
  if (!text || /^\[?\s*inaudible\s*\]?\.?$/i.test(text)) return null;
  return text.slice(0, TRANSCRIPT_MAX);
}

/** Limpia la descripción de una imagen. Null = el modelo dijo que no se puede interpretar. */
export function cleanDescription(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = stripFences(raw);
  if (!text || /^\[?\s*ilegible\s*\]?\.?$/i.test(text)) return null;
  return text.slice(0, DESCRIPTION_MAX);
}

/**
 * Cómo ve el agente un medio ya leído. Lleva el origen del texto: lo dijo (o mostró) la persona, pero la
 * lectura la hizo un modelo y puede equivocarse. Y es contenido de un tercero: dato, nunca instrucción.
 */
export function derivedForPrompt(kind: "transcripcion" | "descripcion_imagen", text: string): string {
  return kind === "transcripcion"
    ? `[Audio del cliente, transcripción automática] ${text}`
    : `[Imagen del cliente, descripción automática] ${text}`;
}

/** Tipos que se sirven en línea al navegador. Todo lo demás baja como descarga, nunca se interpreta. */
const INLINE_MIME = /^(audio\/[a-z0-9.+-]+|image\/(png|jpe?g|webp|gif)|video\/(mp4|webm|3gpp|quicktime))$/i;

export function responseMime(upstream: string | null, kind: MediaKind): { type: string; inline: boolean } {
  const type = (upstream ?? "").split(";")[0].trim().toLowerCase();
  if (INLINE_MIME.test(type) && (kind === "audio" || kind === "image" || kind === "video" || kind === "sticker")) {
    return { type, inline: true };
  }
  return { type: "application/octet-stream", inline: false };
}

/**
 * Rango pedido por el navegador (`Range: bytes=a-b`). Safari no reproduce audio ni video si el servidor no
 * soporta rangos. Devuelve null si no hay rango o es inválido (se responde el archivo entero).
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    // bytes=-N: los últimos N bytes
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}
