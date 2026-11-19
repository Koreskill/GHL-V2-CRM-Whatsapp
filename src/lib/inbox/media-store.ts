import { fetchMedia, type FetchedMedia } from "@/lib/ai/media";
import { createSupabaseAdmin, hasAdminKey } from "@/lib/supabase/admin";
import type { Attachment } from "./media";

// Copia propia de los adjuntos en Supabase Storage (bucket PRIVADO, se crea una vez desde el panel).
// Por qué: Meta descarta el medio entrante de WhatsApp después de un plazo y el endpoint de Zernio pasa a
// responder 400 para siempre (OpenAPI de Zernio). Se guarda al llegar (trabajo `media_store`) y se lee de acá.
//
// Ruta plana `<organización>/<mensaje>-<índice>`: el listado de Storage no es recursivo, y así anonimizar
// una inmobiliaria es listar un solo prefijo. La ruta la arma siempre el servidor con ids ya validados.
export const MEDIA_BUCKET = "mensajes-medios";

const pathOf = (orgId: string, messageId: string, index: number) => `${orgId}/${messageId}-${index}`;

export async function storeMedia(orgId: string, messageId: string, index: number, file: { bytes: Buffer; contentType: string | null }) {
  const { error } = await createSupabaseAdmin()
    .storage.from(MEDIA_BUCKET)
    .upload(pathOf(orgId, messageId, index), file.bytes, { contentType: file.contentType ?? "application/octet-stream", upsert: true });
  if (error) throw new Error(`Storage: ${error.message}`);
}

async function readStored(orgId: string, messageId: string, index: number): Promise<FetchedMedia | null> {
  if (!hasAdminKey()) return null;
  try {
    const { data, error } = await createSupabaseAdmin().storage.from(MEDIA_BUCKET).download(pathOf(orgId, messageId, index));
    if (error || !data) return null;
    return { ok: true, bytes: Buffer.from(await data.arrayBuffer()), contentType: data.type || null };
  } catch {
    return null;
  }
}

/** El archivo de un adjunto: primero la copia propia; si no está, Zernio (y se guarda para la próxima). Nunca tira. */
export async function loadMedia(orgId: string, messageId: string, attachment: Attachment, maxBytes: number): Promise<FetchedMedia> {
  const stored = await readStored(orgId, messageId, attachment.index);
  if (stored?.ok) return stored.bytes.byteLength > maxBytes ? { ok: false, error: "El archivo es demasiado grande" } : stored;
  const file = await fetchMedia(attachment.url, { maxBytes });
  if (file.ok && hasAdminKey()) await storeMedia(orgId, messageId, attachment.index, file).catch(() => {});
  return file;
}

/** Borra todas las copias de una inmobiliaria (al anonimizarla). Devuelve cuántas borró; tira si falla. */
export async function deleteOrgMedia(orgId: string): Promise<number> {
  if (!hasAdminKey()) return 0;
  const bucket = createSupabaseAdmin().storage.from(MEDIA_BUCKET);
  let removed = 0;
  // Se lista siempre desde el principio: lo de la página anterior ya se borró. Tope por si algo no se deja borrar.
  for (let page = 0; page < 1000; page++) {
    const { data, error } = await bucket.list(orgId, { limit: 1000 });
    if (error) throw new Error(`Storage: ${error.message}`);
    if (!data?.length) return removed;
    const { error: rmError } = await bucket.remove(data.map((f) => `${orgId}/${f.name}`));
    if (rmError) throw new Error(`Storage: ${rmError.message}`);
    removed += data.length;
  }
  throw new Error(`Storage: quedaron archivos sin borrar (${removed} borrados)`);
}
