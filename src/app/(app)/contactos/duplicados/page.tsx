import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Copy } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getSession } from "@/lib/auth";
import { findDuplicates } from "@/lib/crm/groups";

export const metadata = { title: "Posibles duplicados · Setter CRM" };

export default async function DuplicadosPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const groups = await findDuplicates(session.organizationId);

  return (
    <>
      <PageHeader
        title="Posibles duplicados"
        subtitle="Contactos distintos con el mismo teléfono o email. Dentro de un mismo canal la identidad ya es única; esto encuentra a la misma persona escribiendo por dos canales o cargada a mano. No se fusiona nada automáticamente."
        actions={
          <Link href="/contactos" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Contactos
          </Link>
        }
      />
      <Card className="overflow-hidden">
        {groups.length === 0 ? (
          <EmptyState icon={Copy} title="Sin duplicados detectados" description="Ningún teléfono ni email se repite entre contactos de esta inmobiliaria." className="py-20" />
        ) : (
          <ul className="divide-y divide-line">
            {groups.map((g) => (
              <li key={`${g.kind}:${g.key}`} className="px-6 py-4">
                <p className="text-[12px] font-medium tracking-wide text-muted uppercase">
                  Mismo {g.kind === "telefono" ? "teléfono" : "email"} · {g.ids.length} contactos
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {g.ids.map((id, i) => (
                    <Link
                      key={id}
                      href={`/contactos?contacto=${id}`}
                      className="inline-flex h-8 items-center rounded-lg border border-line bg-card px-3 text-[13px] text-ink hover:bg-field"
                    >
                      {g.names[i] ?? "Sin nombre"}
                    </Link>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
