import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { NewDealForm } from "@/components/pipeline/new-deal-form";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Users } from "lucide-react";
import { requireOrgId } from "@/lib/auth";
import { listContactOptions } from "@/lib/deals/queries";
import { listTeam } from "@/lib/deals/team";
import { listPropertyOptions } from "@/lib/deals/properties";

export const metadata = { title: "Nueva oportunidad · Setter CRM" };

export default async function NuevaOportunidadPage({ searchParams }: PageProps<"/pipeline/nueva">) {
  const orgId = await requireOrgId();
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error.slice(0, 300) : null;
  const preselectContact = typeof params.contacto === "string" ? params.contacto : null;

  const [contactOptions, team, propertyOptions] = await Promise.all([
    listContactOptions(orgId),
    listTeam(orgId),
    listPropertyOptions(orgId),
  ]);

  return (
    <>
      <PageHeader
        title="Nueva oportunidad"
        subtitle="Una oportunidad por búsqueda: si el contacto pregunta por varias propiedades, van todas acá"
        actions={
          <Link
            href="/pipeline"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <ArrowLeft className="size-4" strokeWidth={1.7} />
            Volver
          </Link>
        }
      />

      <Card className="max-w-2xl p-6">
        {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
        {contactOptions.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Todavía no hay contactos"
            description="Una oportunidad siempre pertenece a un contacto. Los contactos se crean solos cuando alguien escribe por WhatsApp, Instagram o Messenger."
          />
        ) : (
          <NewDealForm
            contacts={contactOptions}
            team={team}
            properties={propertyOptions}
            preselectContact={preselectContact}
          />
        )}
      </Card>
    </>
  );
}
