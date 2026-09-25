/**
 * Enlaces que la inmobiliaria escribió DENTRO de la descripción de una propiedad.
 *
 * En la cartera real, las 40 propiedades tenían el enlace a la publicación (con fotos) y el video
 * de YouTube escritos en el texto de la descripción, y los campos source_url y video_url vacíos.
 * Resultado: el bot no podía mandar la ficha ni las fotos de 39 de las 40, y "¿tenés fotos?" es
 * de las preguntas más frecuentes.
 *
 * Esto NO inventa nada: toma enlaces que ya están escritos en los datos de la propia inmobiliaria.
 * Solo se usa para completar campos VACÍOS; lo cargado a mano o en la hoja siempre manda.
 */

export type DescriptionMedia = {
  /** Publicación o ficha completa (suele tener todas las fotos). */
  ficha: string | null;
  video: string | null;
  tour: string | null;
  fotos: string[];
};

const VIDEO_HOSTS = /(?:^|\.)(?:youtube\.com|youtu\.be|vimeo\.com)$/i;
const TOUR_HOSTS = /(?:^|\.)(?:matterport\.com|kuula\.co|my\.matterport\.com|tour\.|360)/i;
const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|avif)(?:\?|$)/i;

// Enlaces de relleno que quedan en las plantillas ("/p/xxxxxxx", "ejemplo.com"). Un enlace así
// le da un 404 al cliente: peor que no mandar nada.
const PLACEHOLDER = /(?:\/x{3,}|x{5,}|example\.|ejemplo\.|tu-?sitio|link-aca|link-aqui|\{\{)/i;

/**
 * Corta la puntuación que queda pegada al final de un enlace en un texto ("…/264." o "…(P. Esther)")
 * sin romper los paréntesis que SÍ son parte del enlace.
 */
function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?'"»”]+$/, "");
  // Un ")" final solo se saca si no tiene su "(" dentro del enlace.
  while (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) {
    url = url.slice(0, -1).replace(/[.,;:!?]+$/, "");
  }
  return url;
}

function parse(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

export function mediaFromDescription(description: string | null | undefined): DescriptionMedia {
  const out: DescriptionMedia = { ficha: null, video: null, tour: null, fotos: [] };
  if (!description) return out;

  // Hasta un espacio o un corte de línea; los paréntesis se resuelven en trimUrl.
  const found = [...description.matchAll(/https?:\/\/[^\s<>"'`]+/gi)].map((m) => trimUrl(m[0]));

  for (const raw of [...new Set(found)]) {
    if (PLACEHOLDER.test(raw)) continue;
    const u = parse(raw);
    if (!u) continue;
    // Se sube a https cuando se puede: un http:// en WhatsApp aparece como "no seguro".
    const url = u.protocol === "http:" ? raw.replace(/^http:/i, "https:") : raw;

    if (VIDEO_HOSTS.test(u.hostname)) out.video ??= url;
    else if (TOUR_HOSTS.test(u.hostname)) out.tour ??= url;
    else if (IMAGE_EXT.test(u.pathname)) out.fotos.push(url);
    else out.ficha ??= url;
  }

  return out;
}
