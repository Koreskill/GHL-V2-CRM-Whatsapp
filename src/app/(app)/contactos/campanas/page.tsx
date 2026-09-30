import Link from "next/link";
import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth";
import { listBatches } from "@/lib/campaigns/batches";
import { formatListDate } from "@/lib/format";

export const metadata = { title: "Campañas · Setter CRM" };

export default async function CampanasPage() {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const batches = await listBatches(session.organizationId);

  return (
    <>
      <PageHeader title="Campañas" subtitle="Estimá el costo con los filtros de Contactos y confirmá el envío por lote" />
      <Card className="overflow-hidden">
        {batches.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Todavía no hay campañas"
            description="Filtrá contactos y usá «Estimar campaña» para calcular audiencia y costo."
            className="py-20"
          />
        ) : (
          <ul className="divide-y divide-line">
            {batches.map((b) => (
              <li key={b.id}>
                <Link href={`/contactos/campanas/${b.id}`} className="flex items-center gap-4 px-6 py-3.5 hover:bg-field/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{b.name}</span>
                    <span className="block text-[12px] text-muted">{b.templateName} · {formatListDate(b.createdAt.toISOString())}</span>
                  </span>
                  <span className="text-[12.5px] text-muted">{b.audienceCount} destinatarios</span>
                  <span className="rounded-md bg-field px-2 py-0.5 text-[12px] text-ink">{b.status}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
