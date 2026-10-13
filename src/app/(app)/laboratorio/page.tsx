import Link from "next/link";
import { redirect } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getSession } from "@/lib/auth";
import { formatListDate } from "@/lib/format";
import { expireStaleRuns, listLabRuns } from "@/lib/lab/run";
import { LAB_SCENARIOS } from "@/lib/lab/scenarios";
import { startLabRunAction } from "./actions";

export const metadata = { title: "Laboratorio · Setter CRM" };

const STATUS: Record<string, string> = { queued: "En cola", running: "En curso", done: "Terminada", cancelled: "Cancelada", error: "Con error" };

export default async function LaboratorioPage({ searchParams }: PageProps<"/laboratorio">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");
  const params = await searchParams;
  await expireStaleRuns(session.organizationId);
  const runs = await listLabRuns(session.organizationId);
  const error = typeof params.error === "string" ? (params.error === "limite" ? "Demasiadas corridas. Espera un rato." : params.error) : null;

  return (
    <>
      <PageHeader
        title="Laboratorio"
        subtitle="Conversaciones simuladas contra tu agente real. No se envía ningún mensaje ni se crea ningún contacto, oportunidad o visita."
      />
      {error && <p className="mb-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      <Card className="mb-6 p-5">
        <form action={startLabRunAction}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Escenarios</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {LAB_SCENARIOS.map((s) => (
              <label key={s.key} className="flex items-start gap-2.5 rounded-lg border border-line p-3 text-[13px]">
                <input type="checkbox" name="scenario" value={s.key} defaultChecked className="mt-0.5" />
                <span>
                  <span className="block font-medium text-ink">{s.title}</span>
                  <span className="block text-[12px] text-muted">{s.checks}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-muted">Usa modelos reales (consume crédito de IA) y el catálogo actual de tu inmobiliaria.</p>
          <div className="mt-3">
            <Button type="submit">Ejecutar</Button>
          </div>
        </form>
      </Card>

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Corridas</h2>
      {runs.length === 0 ? (
        <Card>
          <EmptyState icon={FlaskConical} title="Sin corridas todavía" description="Ejecuta los escenarios para ver cómo responde tu agente." />
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((r) => {
            const s = r.summary as { passed?: number; scenarios?: number; critical?: number; findings?: number };
            return (
              <Link key={r.id} href={`/laboratorio/${r.id}`}>
                <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition-colors hover:border-primary/40">
                  <span className="text-[14px] font-medium text-ink">{formatListDate(r.createdAt.toISOString())}</span>
                  <span className="text-[12.5px] text-muted">
                    {STATUS[r.status] ?? r.status}
                    {r.status === "done" && ` · ${s.passed ?? 0}/${s.scenarios ?? 0} escenarios sin hallazgos graves · ${s.critical ?? 0} críticos`}
                  </span>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
