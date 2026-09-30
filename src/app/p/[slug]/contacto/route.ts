import { requestOrigin } from "@/lib/request-origin";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { isSlug } from "@/lib/publications/logic";
import { countCta, getPublicListing } from "@/lib/publications/queries";

// El botón de contacto pasa por acá para poder medir los clics. Solo redirige a wa.me con el
// teléfono configurado por la inmobiliaria; nunca a una URL que venga del request.
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: RouteContext<"/p/[slug]/contacto">) {
  const { slug } = await params;
  if (!isSlug(slug)) return new Response("No encontrado", { status: 404 });

  const limit = rateLimit(`cta:${clientIp(req.headers)}`, 30, 60_000);
  if (!limit.ok) return new Response("Demasiadas solicitudes", { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });

  const listing = await getPublicListing(slug);
  const phone = listing?.branding.phone;
  if (!listing || !phone) return new Response("No encontrado", { status: 404 });

  await countCta(slug).catch(() => null);
  const title = listing.headline ?? listing.title ?? "la propiedad";
  const message = `Hola, me interesa ${title}. ${requestOrigin(req)}/p/${slug}`;
  return Response.redirect(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, 302);
}
