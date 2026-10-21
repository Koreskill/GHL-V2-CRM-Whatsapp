import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, Repeat } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth";
import { listSequences } from "@/lib/followups/queries";
import { cn } from "@/lib/utils";

export const metadata = { title: "Seguimientos · Setter CRM" };

export default async function SeguimientosPage() {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const seqs = await listSequences(session.organizationId);

  return (
    <>
      <PageHeader
        title="Seguimientos"
        subtitle="Mensajes automáticos cuando el contacto deja de responder. Salen solo dentro de la ventana de 24 h del canal, en el horario permitido y se cortan apenas responde."
        actions={
          <Link href="/seguimientos/nueva" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover">
            <Plus className="size-4" strokeWidth={2} /> Nueva secuencia
          </Link>
        }
      />
      <Card className="overflow-hidden">
        {seqs.length === 0 ? (
          <EmptyState icon={Repeat} title="Sin secuencias" description="Creá una para retomar conversaciones que quedaron sin respuesta del contacto." className="py-20" />
        ) : (
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line text-[11.5px] font-semibold tracking-wide text-muted uppercase">
                <th className="px-6 py-3">Secuencia</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Pasos</th>
                <th className="px-4 py-3 text-right">En curso</th>
                <th className="px-4 py-3 text-right">Mensajes enviados</th>
                <th className="px-6 py-3 text-right" title="Conversaciones que respondieron después de recibir al menos un seguimiento">Reactivadas</th>
              </tr>
            </thead>
            <tbody>
              {seqs.map((s) => (
                <tr key={s.id} className="border-b border-line/70 last:border-0 hover:bg-field/50">
                  <td className="px-6 py-3.5">
                    <Link href={`/seguimientos/${s.id}`} className="font-medium text-ink hover:underline">
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-[12px] font-medium", s.enabled ? "bg-accent-green/10 text-accent-green" : "bg-field text-muted")}>
                      {s.enabled ? "Encendida" : "Apagada"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right tabular-nums">{s.steps}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums">{s.activas}</td>
                  <td className="px-4 py-3.5 text-right tabular-nums">{s.enviados}</td>
                  <td className="px-6 py-3.5 text-right tabular-nums">{s.reactivadas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
