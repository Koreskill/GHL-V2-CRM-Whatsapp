import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Bath, BedDouble, Car, MapPin, MessageCircle, Play, Ruler, Rotate3d } from "lucide-react";
import { getSession } from "@/lib/auth";
import { COWIN_BRAND, brandHex, isSlug, publicImages, publicLocation } from "@/lib/publications/logic";
import { countView, getPublicListing } from "@/lib/publications/queries";

// Ficha pública: sin login, sin app shell. Todo lo que se ve sale de getPublicListing (solo campos comerciales).
export const dynamic = "force-dynamic";

const OPERATION: Record<string, string> = { venta: "En venta", alquiler: "En alquiler", temporario: "Alquiler temporario" };

const money = (price: number | null, currency: string) =>
  price === null ? "Consultar" : `${currency} ${price.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

export async function generateMetadata({ params }: PageProps<"/p/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const listing = isSlug(slug) ? await getPublicListing(slug) : null;
  if (!listing) return { title: "Propiedad no disponible", robots: { index: false } };
  const title = listing.headline ?? listing.title ?? "Propiedad";
  const images = publicImages(listing).slice(0, 1);
  return {
    title: `${title} · ${COWIN_BRAND.name}`,
    description: `${money(listing.price, listing.currency)} · ${publicLocation(listing, false) ?? ""}`.trim(),
    openGraph: { title, images },
  };
}

export default async function PublicPropertyPage({ params, searchParams }: PageProps<"/p/[slug]">) {
  const { slug } = await params;
  if (!isSlug(slug)) notFound();
  // Vista previa: solo para quien pertenece a la inmobiliaria dueña, y solo si la pide con ?preview=1.
  const preview = (await searchParams).preview === "1" ? await getSession() : null;
  const l = await getPublicListing(slug, preview ? { previewOrgId: preview.organizationId } : {});
  // Pausada, en borrador o inexistente: la misma respuesta, sin dar pistas de cuál es.
  if (!l) notFound();
  const isPreview = Boolean(preview) && l.orgId === preview?.organizationId;
  if (!isPreview) void countView(l.pubId);

  const isOrgBrand = l.brand === "inmobiliaria";
  const color = isOrgBrand ? brandHex(l.branding.colorId) : COWIN_BRAND.color;
  const brandName = isOrgBrand ? (l.branding.name ?? l.orgName) : COWIN_BRAND.name;
  const agencyName = l.branding.name ?? l.orgName;
  const images = publicImages(l);
  const available = l.status === "disponible" || l.status === "reservada";
  const title = l.headline ?? l.title ?? "Propiedad";
  const location = publicLocation(l, l.showAddress);

  const facts = [
    l.bedrooms ? { Icon: BedDouble, label: `${l.bedrooms} dormitorio${l.bedrooms === 1 ? "" : "s"}` } : null,
    l.bathrooms ? { Icon: Bath, label: `${l.bathrooms} baño${l.bathrooms === 1 ? "" : "s"}` } : null,
    l.parking ? { Icon: Car, label: `${l.parking} cochera${l.parking === 1 ? "" : "s"}` } : null,
    l.areaM2 ? { Icon: Ruler, label: `${l.areaM2} m² totales` } : null,
    l.areaCoveredM2 ? { Icon: Ruler, label: `${l.areaCoveredM2} m² cubiertos` } : null,
  ].filter((f): f is NonNullable<typeof f> => f !== null);

  return (
    <div className="min-h-screen bg-canvas">
      <header style={{ backgroundColor: color }} className="text-white">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4">
          {isOrgBrand && l.branding.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo en un dominio https cualquiera
            <img src={l.branding.logoUrl} alt="" className="h-8 w-auto max-w-40 rounded bg-white/90 object-contain p-0.5" />
          ) : null}
          <span className="text-[18px] font-bold tracking-tight">{brandName}</span>
        </div>
      </header>

      {isPreview && (
        <p role="status" className="bg-accent-amber/15 px-4 py-2 text-center text-[13px] font-medium text-ink">
          Vista previa: así se ve la ficha. Solo la ven quienes tienen sesión en tu inmobiliaria hasta que la publiques.
        </p>
      )}
      <main className="mx-auto max-w-5xl px-4 py-6">
        {!available && (
          <p role="status" className="mb-4 rounded-xl border border-line bg-card px-4 py-3 text-[14px] text-muted">
            Esta propiedad ya no está disponible.
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="aspect-[16/10] overflow-hidden rounded-2xl bg-field">
              {images[0] && (
                // eslint-disable-next-line @next/next/no-img-element -- fotos en dominios https arbitrarios
                <img src={images[0]} alt={title} className="size-full object-cover" />
              )}
            </div>
            {images.length > 1 && (
              <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
                {images.slice(1, 13).map((url) => (
                  <li key={url} className="aspect-[4/3] overflow-hidden rounded-lg bg-field">
                    {/* eslint-disable-next-line @next/next/no-img-element -- ídem */}
                    <img src={url} alt="" loading="lazy" className="size-full object-cover" />
                  </li>
                ))}
              </ul>
            )}

            {l.description && (
              <section className="mt-6">
                <h2 className="text-[16px] font-semibold text-ink">Descripción</h2>
                <p className="mt-2 whitespace-pre-line text-[14.5px] leading-relaxed text-ink">{l.description}</p>
              </section>
            )}

            {l.amenities.length > 0 && (
              <section className="mt-6">
                <h2 className="text-[16px] font-semibold text-ink">Comodidades</h2>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {l.amenities.map((a) => (
                    <li key={a} className="rounded-full border border-line bg-card px-3 py-1 text-[13px] text-ink">
                      {a}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <aside className="min-w-0">
            <div className="rounded-2xl border border-line bg-card p-5">
              <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">
                {OPERATION[l.operation] ?? l.operation} · {l.propertyType}
              </p>
              <h1 className="mt-1 text-[22px] leading-tight font-bold text-ink">{title}</h1>
              <p className="mt-3 text-[28px] font-bold tabular-nums text-ink">{money(l.price, l.currency)}</p>
              {location && (
                <p className="mt-2 flex items-start gap-1.5 text-[14px] text-muted">
                  <MapPin className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} />
                  {location}
                </p>
              )}

              {facts.length > 0 && (
                <ul className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4">
                  {facts.map(({ Icon, label }) => (
                    <li key={label} className="flex items-center gap-2 text-[13.5px] text-ink">
                      <Icon className="size-4 text-muted" strokeWidth={1.7} />
                      {label}
                    </li>
                  ))}
                </ul>
              )}

              {(l.videoUrl || l.tour360Url) && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {l.videoUrl && (
                    <a href={l.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink hover:bg-field">
                      <Play className="size-4" strokeWidth={1.8} /> Ver video
                    </a>
                  )}
                  {l.tour360Url && (
                    <a href={l.tour360Url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-medium text-ink hover:bg-field">
                      <Rotate3d className="size-4" strokeWidth={1.8} /> Tour 360°
                    </a>
                  )}
                </div>
              )}

              {available && (
                <a
                  href={`/p/${slug}/contacto`}
                  style={{ backgroundColor: color }}
                  className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-white hover:opacity-90"
                >
                  <MessageCircle className="size-5" strokeWidth={1.8} />
                  Consultar por WhatsApp
                </a>
              )}
              <p className="mt-4 text-[12.5px] text-muted">Publica: {agencyName}</p>
            </div>
          </aside>
        </div>

        {l.branding.legal && <p className="mt-8 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">{l.branding.legal}</p>}
      </main>
    </div>
  );
}
