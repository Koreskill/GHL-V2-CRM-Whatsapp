import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PropertyForm } from "@/components/properties/property-form";
import { Card, PageHeader } from "@/components/ui/primitives";
import { requireOrgId } from "@/lib/auth";

export const metadata = { title: "Nueva propiedad · Setter CRM" };

export default async function NuevaPropiedadPage({ searchParams }: PageProps<"/propiedades/nueva">) {
  await requireOrgId();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error.slice(0, 300) : null;

  return (
    <>
      <PageHeader
        title="Nueva propiedad"
        subtitle="Se carga en el CRM y la sincronización con la hoja no la toca"
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
      <Card className="max-w-3xl p-6">
        {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
        <PropertyForm values={{}} fromSheet={false} />
      </Card>
    </>
  );
}
