import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  ExternalLink,
  GitBranch,
  MapPin,
  MessageCircle,
  Play,
  Rotate3d,
} from "lucide-react";
import { VISIT_LABEL, VISIT_TONE } from "@/components/visits/visit-card";
import { Card, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/api";
import { requireOrgId } from "@/lib/auth";
import { formatListDate } from "@/lib/format";
import { getProperty, listPropertyInterest } from "@/lib/properties/catalog";
import { STAGE_LABEL } from "@/lib/pipeline";
import { listVisitsByProperty } from "@/lib/visits/queries";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  disponible: "bg-accent-green/12 text-accent-green",
  reservada: "bg-accent-amber/12 text-accent-amber",
  vendida: "bg-field text-muted",
  alquilada: "bg-field text-muted",
  pausada: "bg-field text-muted",
  borrador: "bg-field text-muted",
};

function Dato({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="truncate text-right text-[13px] text-ink">{value ?? <span className="text-muted">—</span>}</dd>
    </div>
  );
}

export default async function PropiedadPage({ params }: PageProps<"/propiedades/[propertyId]">) {
  const orgId = await requireOrgId();
  const { propertyId } = await params;
  if (!isUuid(propertyId)) notFound();

  const property = await getProperty(propertyId, orgId);
  if (!property) notFound();

  const [interest, visits] = await Promise.all([
    listPropertyInterest(propertyId, orgId),
    listVisitsByProperty(propertyId, orgId),
  ]);

  const price =
    property.price === null
      ? null
      : `${property.currency} ${property.price.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;

  return (
    <>
      <PageHeader
        title={property.title ?? "Sin título"}
        subtitle={`${property.operation} · ${property.propertyType}${property.zone ? ` · ${property.zone}` : ""}${property.city ? `, ${property.city}` : ""}`}
        actions={
          <Link
            href="/propiedades"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <ArrowLeft className="size-4" strokeWidth={1.7} />
            Cartera
          </Link>
        }
      />

      {/* Lo que falta se señala, no se completa por las nuestras. */}
      {property.syncIssues.length > 0 && (
        <Card className="mb-5 border-accent-amber/40 bg-accent-amber/5 p-4">
          <div className="flex gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-amber" strokeWidth={1.8} />
            <div>
              <p className="text-[13.5px] font-medium text-ink">Datos incompletos en la hoja</p>
              <ul className="mt-1 list-inside list-disc text-[13px] text-muted">
                {property.syncIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-5">
          <Card className="overflow-hidden">
            <div className="aspect-[16/9] w-full bg-field">
              {property.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- las fotos viven en dominios arbitrarios de la hoja
                <img src={property.coverUrl} alt="" className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-[13px] text-muted">Sin portada</span>
              )}
            </div>

            {property.galleryUrls.length > 0 && (
              <div className="flex gap-2 overflow-x-auto p-3">
                {property.galleryUrls.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element -- ídem portada
                  <img
                    key={url}
                    src={url}
                    alt=""
                    loading="lazy"
                    className="h-20 w-28 shrink-0 rounded-lg object-cover"
                  />
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
              {property.videoUrl && (
                <a
                  href={property.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink hover:bg-field"
                >
                  <Play className="size-3.5" strokeWidth={1.8} /> Video
                </a>
              )}
              {property.tour360Url && (
                <a
                  href={property.tour360Url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink hover:bg-field"
                >
                  <Rotate3d className="size-3.5" strokeWidth={1.8} /> Tour 360°
                </a>
              )}
              {property.mapUrl && (
                <a
                  href={property.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink hover:bg-field"
                >
                  <MapPin className="size-3.5" strokeWidth={1.8} /> Ubicación
                </a>
              )}
              {property.sourceUrl && (
                <a
                  href={property.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-ink hover:bg-field"
                >
                  <ExternalLink className="size-3.5" strokeWidth={1.8} /> Aviso original
                </a>
              )}
            </div>
          </Card>

          {property.description && (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-ink">Descripción</h2>
              <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
                {property.description}
              </p>
            </Card>
          )}

          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <MessageCircle className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Quién consultó</h2>
            </div>
            {interest.length === 0 ? (
              <p className="px-5 py-5 text-[13px] text-muted">Todavía nadie preguntó por esta propiedad.</p>
            ) : (
              <ul className="divide-y divide-line">
                {interest.map((i) => (
                  <li key={i.dealId} className="flex items-center gap-3 px-5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{i.contactName}</span>
                      <span className="block truncate text-[12px] text-muted">
                        {i.contactPhone ?? "Sin teléfono"} · {STAGE_LABEL[i.stage]}
                        {i.status !== "abierta" && ` · ${i.status}`}
                      </span>
                    </span>
                    {i.conversationId && (
                      <Link
                        href={`/conversaciones/${i.conversationId}`}
                        title="Abrir la conversación"
                        className="grid size-8 place-items-center rounded-md text-muted hover:bg-field hover:text-ink"
                      >
                        <MessageCircle className="size-4" strokeWidth={1.7} />
                      </Link>
                    )}
                    <Link
                      href={`/pipeline/${i.dealId}`}
                      title="Abrir la oportunidad"
                      className="grid size-8 place-items-center rounded-md text-muted hover:bg-field hover:text-ink"
                    >
                      <GitBranch className="size-4" strokeWidth={1.7} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="flex items-center gap-2 border-b border-line px-5 py-4">
              <CalendarClock className="size-4 text-muted" strokeWidth={1.7} />
              <h2 className="text-[15px] font-semibold text-ink">Visitas</h2>
            </div>
            {visits.length === 0 ? (
              <p className="px-5 py-5 text-[13px] text-muted">Sin visitas a esta propiedad.</p>
            ) : (
              <ul className="divide-y divide-line">
                {visits.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 px-5 py-2.5">
                    <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11.5px] font-medium", VISIT_TONE[v.status])}>
                      {VISIT_LABEL[v.status]}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{v.contactName}</span>
                    <span className="shrink-0 text-[12px] text-muted">
                      {v.scheduledAt ? formatListDate(v.scheduledAt) : "sin fecha"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[22px] font-bold tabular-nums text-ink">
                {price ?? <span className="text-[15px] font-medium text-muted">Sin precio</span>}
              </p>
              <span
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11.5px] font-medium",
                  STATUS_TONE[property.status] ?? "bg-field text-muted",
                )}
              >
                {property.status}
              </span>
            </div>

            <dl className="mt-3 divide-y divide-line border-t border-line pt-1">
              <Dato label="Operación" value={property.operation} />
              <Dato label="Tipo" value={property.propertyType} />
              <Dato label="Dormitorios" value={property.bedrooms} />
              <Dato label="Baños" value={property.bathrooms} />
              <Dato label="Cocheras" value={property.parking} />
              <Dato label="Superficie total" value={property.areaM2 ? `${property.areaM2} m²` : null} />
              <Dato label="Superficie cubierta" value={property.areaCoveredM2 ? `${property.areaCoveredM2} m²` : null} />
              <Dato label="Dirección" value={property.addressPublic} />
              <Dato label="Barrio" value={property.zone} />
              <Dato label="Ciudad" value={property.city} />
            </dl>
          </Card>

          {property.amenities.length > 0 && (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-ink">Amenities</h2>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {property.amenities.map((a) => (
                  <span key={a} className="rounded-full bg-field px-2.5 py-1 text-[12.5px] text-ink">
                    {a}
                  </span>
                ))}
              </div>
            </Card>
          )}

          {/* Privado del tenant: nunca se comparte ni se manda al cliente. */}
          {property.internalNotes && (
            <Card className="p-5">
              <h2 className="text-[15px] font-semibold text-ink">Observaciones internas</h2>
              <p className="mt-1 text-[12px] text-muted">Solo las ve tu equipo.</p>
              <p className="mt-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
                {property.internalNotes}
              </p>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-[15px] font-semibold text-ink">Origen</h2>
            <dl className="mt-2 divide-y divide-line">
              <Dato
                label="Fuente"
                value={property.source === "google_sheets" ? "Google Sheets" : "Carga manual"}
              />
              <Dato label="property_id" value={property.externalId} />
              <Dato
                label="Actualizada en la hoja"
                value={property.externalUpdatedAt ? formatListDate(property.externalUpdatedAt) : null}
              />
              <Dato
                label="Última sincronización"
                value={property.syncedAt ? formatListDate(property.syncedAt) : null}
              />
            </dl>
            {property.source === "google_sheets" && (
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                Esta propiedad se edita en la hoja de Google. Los cambios que hagas ahí se reflejan acá en la
                próxima sincronización.
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
