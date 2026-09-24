import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PropertyForm } from "@/components/properties/property-form";
import { Card, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/api";
import { requireOrgId } from "@/lib/auth";
import { getProperty } from "@/lib/properties/catalog";

export const metadata = { title: "Editar propiedad · Setter CRM" };

export default async function EditarPropiedadPage({
  params,
  searchParams,
}: PageProps<"/propiedades/[propertyId]/editar">) {
  const orgId = await requireOrgId();
  const { propertyId } = await params;
  if (!isUuid(propertyId)) notFound();

  const property = await getProperty(propertyId, orgId);
  if (!property) notFound();

  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error.slice(0, 300) : null;

  return (
    <>
      <PageHeader
        title="Editar propiedad"
        subtitle={property.title ?? "Sin título"}
        actions={
          <Link
            href={`/propiedades/${propertyId}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <ArrowLeft className="size-4" strokeWidth={1.7} />
            Volver a la ficha
          </Link>
        }
      />
      <Card className="max-w-3xl p-6">
        {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
        <PropertyForm
          values={{
            id: property.id,
            title: property.title,
            operation: property.operation,
            propertyType: property.propertyType,
            status: property.status,
            price: property.price,
            currency: property.currency,
            description: property.description,
            addressPublic: property.addressPublic,
            zone: property.zone,
            city: property.city,
            mapUrl: property.mapUrl,
            bedrooms: property.bedrooms,
            bathrooms: property.bathrooms,
            parking: property.parking,
            areaM2: property.areaM2,
            areaCoveredM2: property.areaCoveredM2,
            amenities: property.amenities,
            coverUrl: property.coverUrl,
            galleryUrls: property.galleryUrls,
            videoUrl: property.videoUrl,
            tour360Url: property.tour360Url,
            sourceUrl: property.sourceUrl,
            internalNotes: property.internalNotes,
          }}
          // Solo avisa si todavía está bajo control de la hoja.
          fromSheet={property.source === "google_sheets" && property.manuallyEditedAt === null}
        />
      </Card>
    </>
  );
}
