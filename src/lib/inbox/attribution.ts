/**
 * De qué anuncio o enlace vino una conversación.
 *
 * Zernio reenvía el `referral` que manda Meta al hacer click; `ingest.ts` lo guarda tal cual en
 * `conversations.metadata.attribution`. Acá se LEE: es una función pura (sin base) para poder
 * probarla, y es la única que decide qué es un anuncio, así la bandeja, el bot y los reportes
 * no tienen cada uno su propia idea.
 *
 * Campos según el OpenAPI de Zernio 1.62.0 (`metadata.referral` de `message.received`):
 *  - WhatsApp Click-to-WhatsApp: `ctwa_clid` + `source_*`, `headline`, `body`, `media_type`.
 *  - Messenger / Instagram Click-to-Message: `ad_id` + `ads_context_data.ad_title`.
 *  - Enlaces ig.me / m.me: `ref` sin `ad_id` (no es un anuncio, es un enlace con etiqueta).
 */

export type OriginKind = "anuncio" | "enlace";

export type AdOrigin = {
  kind: OriginKind;
  /** Titular del anuncio, si Meta lo mandó. */
  title: string | null;
  /** Texto del anuncio. Es contenido de terceros: se muestra como texto, nunca se interpreta. */
  body: string | null;
  /** ID del anuncio en Meta (Messenger e Instagram). En WhatsApp es `sourceId`. */
  adId: string | null;
  /** Identificador del click de WhatsApp: lo que hace falta para devolverle la conversión a Meta. */
  clickId: string | null;
  /** Parámetro `ref` de un enlace o anuncio. */
  ref: string | null;
  /** Dónde estaba el anuncio (publicación, anuncio de Instagram…), solo https. */
  sourceUrl: string | null;
  /** Miniatura del anuncio, solo https. */
  imageUrl: string | null;
  mediaType: string | null;
  capturedAt: string | null;
};

const TITLE_MAX = 200;
const BODY_MAX = 400;
const REF_MAX = 120;
const ID_MAX = 80;

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

/** Una URL que viene de un tercero y termina en el navegador: solo https, sin credenciales. */
export function httpsUrl(value: unknown): string | null {
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
 * Interpreta `conversations.metadata`. Devuelve null si no hay anuncio ni enlace de origen.
 * Una conversación importada (`source: "import"`) no es una atribución de click: se ignora.
 */
export function readAttribution(metadata: unknown): AdOrigin | null {
  const meta = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : null;
  const raw = meta?.attribution;
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  if (a.source === "import") return null;

  const ctx = a.ads_context_data && typeof a.ads_context_data === "object" ? (a.ads_context_data as Record<string, unknown>) : {};

  const clickId = str(a.ctwa_clid, ID_MAX);
  const adId = str(a.ad_id, ID_MAX) ?? (clickId ? str(a.source_id, ID_MAX) : null);
  const ref = str(a.ref, REF_MAX);
  const title = str(a.headline, TITLE_MAX) ?? str(ctx.ad_title, TITLE_MAX);

  // Un anuncio tiene click de WhatsApp, id de anuncio o la marca ADS de Meta. Un `ref` suelto
  // (enlace ig.me / m.me) es otra cosa: se muestra distinto y "solo anuncios" no lo toma.
  const isAd = Boolean(clickId || adId || a.source === "ADS" || str(a.source_type, 20)?.toLowerCase() === "ad");
  if (!isAd && !ref) return null;

  return {
    kind: isAd ? "anuncio" : "enlace",
    title,
    body: str(a.body, BODY_MAX),
    adId,
    clickId,
    ref,
    sourceUrl: httpsUrl(a.source_url),
    imageUrl: httpsUrl(a.thumbnail_url) ?? httpsUrl(a.image_url) ?? httpsUrl(ctx.photo_url),
    mediaType: str(a.media_type, 20),
    capturedAt: str(a.capturedAt, 40),
  };
}

/** Texto corto para la lista de conversaciones. */
export function originLabel(origin: AdOrigin): string {
  if (origin.kind === "enlace") return origin.ref ? `Enlace: ${origin.ref}` : "Enlace";
  return origin.title ?? "Anuncio";
}
