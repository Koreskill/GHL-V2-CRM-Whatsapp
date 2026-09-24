import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Info } from "lucide-react";
import { NewClientForm } from "@/components/agency/new-client-form";
import { Card, PageHeader } from "@/components/ui/primitives";
import { requireAgencyAdmin } from "@/lib/auth";

export const metadata = { title: "Nuevo cliente · Setter CRM" };

export default async function NuevoClientePage({ searchParams }: PageProps<"/agencia/nuevo">) {
  const session = await requireAgencyAdmin();
  if (!session) redirect("/");
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error.slice(0, 300) : null;

  return (
    <>
      <PageHeader
        title="Nuevo cliente"
        subtitle="Crea la inmobiliaria y su usuario administrador en un solo paso"
        actions={
          <Link
            href="/agencia"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
          >
            <ArrowLeft className="size-4" strokeWidth={1.7} />
            Volver
          </Link>
        }
      />

      <div className="grid max-w-4xl gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <Card className="p-6">
          {error && (
            <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>
          )}
          <NewClientForm />
        </Card>

        <Card className="h-fit p-5">
          <div className="flex items-center gap-2">
            <Info className="size-4 text-muted" strokeWidth={1.7} />
            <p className="text-[13px] font-semibold text-ink">Qué pasa al crear</p>
          </div>
          <ul className="mt-3 flex flex-col gap-2.5 text-[13px] leading-relaxed text-muted">
            <li>Se crea la inmobiliaria con sus datos aislados: nadie más los ve.</li>
            <li>El usuario entra con su email y la contraseña que pongas acá.</li>
            <li>Queda como administrador: puede configurar el agente y conectar cuentas.</li>
            <li>El agente arranca apagado en todos los canales.</li>
            <li>Copia la contraseña antes de guardar: después no se puede volver a ver.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
