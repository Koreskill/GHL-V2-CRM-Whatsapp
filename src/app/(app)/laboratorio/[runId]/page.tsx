import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { InboxAutoRefresh } from "@/components/inbox/inbox-auto-refresh";
import { isUuid } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { getLabRun } from "@/lib/lab/run";
import { LAB_SCENARIOS } from "@/lib/lab/scenarios";
import { cancelLabRunAction } from "../actions";

export const metadata = { title: "Corrida · Laboratorio" };

const SEVERITY: Record<string, string> = {
  critico: "bg-accent-red/12 text-accent-red",
  alto: "bg-accent-orange/12 text-accent-orange",
  medio: "bg-accent-amber/12 text-accent-amber",
  info: "bg-field text-muted",
};

export default async function CorridaPage({ params }: PageProps<"/laboratorio/[runId]">) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "admin") redirect("/");
  const { runId } = await params;
  if (!isUuid(runId)) notFound();
  // Filtra por la organización de la sesión: una corrida ajena es un 404.
  const data = await getLabRun(session.organizationId, runId);
  if (!data) notFound();
  const { run, turns, findings } = data;
  const live = run.status === "queued" || run.status === "running";

  return (
    <>
      {live && <InboxAutoRefresh />}
      <PageHeader
        title="Corrida del Laboratorio"
        subtitle={`${run.status === "done" ? "Terminada" : live ? "En curso…" : run.status}${run.error ? ` · ${run.error}` : ""}`}
        actions={
          <div className="flex gap-2">
            <Link href="/laboratorio">
              <Button variant="secondary">Volver</Button>
            </Link>
            {live && (
              <form action={cancelLabRunAction}>
                <input type="hidden" name="runId" value={run.id} />
                <Button type="submit" variant="secondary">
                  Cancelar
                </Button>
              </form>
            )}
          </div>
        }
      />
      <p className="mb-4 text-[12px] text-muted">
        Se probó con: {JSON.stringify(run.snapshot)}. Los resultados dependen de modelos que no son deterministas: repite un caso dudoso antes de sacar conclusiones.
      </p>

      {run.scenarioKeys.map((key) => {
        const sc = LAB_SCENARIOS.find((s) => s.key === key);
        const sTurns = turns.filter((t) => t.scenarioKey === key);
        const sFindings = findings.filter((f) => f.scenarioKey === key);
        return (
          <Card key={key} className="mb-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-[15px] font-semibold text-ink">{sc?.title ?? key}</h2>
              <span className={`rounded-md px-2 py-0.5 text-[11.5px] font-medium ${sFindings.length ? SEVERITY[sFindings.some((f) => f.severity === "critico") ? "critico" : "alto"] : "bg-accent-green/12 text-accent-green"}`}>
                {sTurns.length === 0 ? "Pendiente" : sFindings.length ? `${sFindings.length} hallazgo(s)` : "Sin hallazgos"}
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {sTurns.map((t) => (
                <div key={t.id} className="text-[13px]">
                  <p className="rounded-lg bg-field px-3 py-2 text-ink">
                    <span className="text-muted">Cliente: </span>
                    {t.clientText}
                  </p>
                  <p className="mt-1 rounded-lg border border-line px-3 py-2 whitespace-pre-wrap text-ink">
                    <span className="text-muted">
                      Agente ({t.disposition ?? "—"}
                      {t.route ? ` · ${t.route}` : ""}
                      {t.source ? ` · ${t.source}` : ""}):{" "}
                    </span>
                    {t.replyText ?? "— sin respuesta —"}
                  </p>
                  {t.simulatedActions.length > 0 && (
                    <p className="mt-1 text-[12px] text-muted">Habría hecho (no se ejecutó): {t.simulatedActions.join(" · ")}</p>
                  )}
                </div>
              ))}
            </div>
            {sFindings.length > 0 && (
              <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                {sFindings.map((f) => (
                  <li key={f.id} className="flex items-start gap-2 text-[12.5px]">
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${SEVERITY[f.severity] ?? SEVERITY.info}`}>{f.severity}</span>
                    <span className="text-ink">
                      <b>{f.rule}</b>
                      {f.turnIdx !== null ? ` (turno ${f.turnIdx + 1})` : ""}: {f.evidence}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </>
  );
}
