import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import { authorize, isUuid, jsonError } from "@/lib/api";
import { MAX_SERVE_BYTES } from "@/lib/ai/media";
import { attachmentsFromPayload, parseRange, responseMime } from "@/lib/inbox/media";
import { loadMedia } from "@/lib/inbox/media-store";

// Sirve el audio, la imagen o el archivo de un mensaje al navegador del equipo.
//
// Por qué una ruta propia: los medios entrantes de WhatsApp están detrás de la API de Zernio y exigen la clave del
// servidor, que el navegador no tiene (ni debe tener). Acá se baja con esa clave y se reenvía. Reglas:
//  - solo se sirve un medio de un mensaje de LA ORGANIZACIÓN de la sesión (el id del mensaje no alcanza);
//  - la URL sale de lo guardado al recibir el mensaje, nunca de un parámetro del pedido (no es un proxy abierto);
//  - lo que no es audio/imagen/video conocido baja como descarga, nunca se interpreta en el navegador;
//  - soporta Range: Safari no reproduce audio ni video sin él.
export const dynamic = "force-dynamic";

const safeName = (name: string | null) => (name ?? "archivo").replace(/[^\w.-]+/g, "_").slice(0, 80) || "archivo";

export async function GET(req: Request, { params }: RouteContext<"/api/messages/[messageId]/media">) {
  const auth = await authorize("agent", { name: "message-media", max: 300, windowMs: 60_000 });
  if ("response" in auth) return auth.response;

  const { messageId } = await params;
  if (!isUuid(messageId)) return jsonError(400, "Mensaje inválido");
  const index = Number(new URL(req.url).searchParams.get("i") ?? "0");
  if (!Number.isInteger(index) || index < 0 || index > 9) return jsonError(400, "Adjunto inválido");

  const [msg] = await getDb()
    .select({ rawPayload: messages.rawPayload })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.organizationId, auth.session.organizationId)));
  const attachment = msg ? attachmentsFromPayload(msg.rawPayload).find((a) => a.index === index) : undefined;
  if (!attachment?.url) return jsonError(404, "No se encontró el archivo");

  // Copia propia primero (la de Zernio deja de existir cuando Meta descarta el medio); si no está, se baja y se guarda.
  // La ruta de Storage sale de ids ya validados contra la organización de la sesión.
  const file = await loadMedia(auth.session.organizationId, messageId, attachment, MAX_SERVE_BYTES);
  if (!file.ok) {
    console.error("[medios]", file.error);
    return jsonError(502, "No se pudo cargar el archivo");
  }

  const { type, inline } = responseMime(file.contentType ?? attachment.mime, attachment.kind);
  const size = file.bytes.byteLength;
  const range = parseRange(req.headers.get("range"), size);
  const body = range ? file.bytes.subarray(range.start, range.end + 1) : file.bytes;

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(body.byteLength),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName(attachment.name)}"`,
    // Aunque algo se abriera en una pestaña, no puede ejecutar nada.
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return new Response(new Uint8Array(body), { status: range ? 206 : 200, headers });
}
