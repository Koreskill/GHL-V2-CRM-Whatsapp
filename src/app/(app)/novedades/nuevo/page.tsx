import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EventForm } from "@/components/news/event-form";
import { Card, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { networks } from "@/db/schema";
import { listOrganizations } from "@/lib/agency/queries";
import { requireAgencyAdmin } from "@/lib/auth";
import { createNewsEvent } from "../actions";

export const metadata = { title: "Nuevo evento · Setter CRM" };

export default async function NuevoEventoPage({ searchParams }: PageProps<"/novedades/nuevo">) {
  // Solo el equipo interno crea eventos; el servidor lo valida también en la acción.
  const session = await requireAgencyAdmin();
  if (!session) redirect("/novedades");
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;

  const [nets, orgs] = await Promise.all([getDb().select({ id: networks.id, name: networks.name }).from(networks).orderBy(networks.name), listOrganizations()]);

  return (
    <>
      <PageHeader
        title="Nuevo evento"
        subtitle="Elegí a quién va dirigido: la red, el equipo interno o un cliente"
        actions={
          <Link href="/novedades" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Novedades
          </Link>
        }
      />
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
      <Card className="p-6">
        <EventForm action={createNewsEvent} networks={nets} clients={orgs.map((o) => ({ id: o.id, name: o.name }))} submitLabel="Crear evento" />
      </Card>
    </>
  );
}
