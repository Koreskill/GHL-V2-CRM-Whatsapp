import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, FlaskConical, History, MessageSquareWarning } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { requireRole } from "@/lib/auth";
import { feedbackCounts, listFeedback } from "@/lib/agent/feedback";
import { listVersions } from "@/lib/agent/versions";
import { cn } from "@/lib/utils";
import { restoreAgentVersion, reviewFeedbackAction } from "../actions";

export const metadata = { title: "Mejora del agente · Setter CRM" };

const SCOPES = [
  { id: "global", label: "General" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Messenger" },
] as const;
const field = "rounded-lg border border-line bg-field px-3 py-2 text-[13.5px] text-ink focus:border-primary focus:outline-none";

export default async function AgenteMejoraPage({ searchParams }: PageProps<"/configuracion/agente">) {
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const orgId = session.organizationId;
  const sp = await searchParams;
  const scope = SCOPES.some((s) => s.id === sp.scope) ? String(sp.scope) : "global";
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const error = typeof sp.error === "string" ? sp.error : null;

  const [versions, pending, examples, counts] = await Promise.all([
    listVersions(orgId, scope),
    listFeedback(orgId, "pendiente"),
    listFeedback(orgId, "aprobado"),
    feedbackCounts(orgId),
  ]);
  const approvedExamples = examples.filter((e) => e.kind === "ejemplo");
  const totalProblems = counts.filter((c) => c.kind === "problema" || c.kind === "ejemplo").reduce((a, c) => a + c.n, 0);

  return (
    <>
      <PageHeader
        title="Mejora del agente"
        subtitle="Historial de la configuración, respuestas reportadas por el equipo y ejemplos aprobados. Nada que escriba un cliente entra al agente sin que lo apruebe un administrador."
        actions={
          <div className="flex gap-2">
            <Link href="/laboratorio" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
              <FlaskConical className="size-4" strokeWidth={1.7} /> Probar en Laboratorio
            </Link>
            <Link href={`/configuracion?tab=${scope}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
              <ArrowLeft className="size-4" strokeWidth={1.7} /> Configuración
            </Link>
          </div>
        }
      />
      {ok && <p className="mb-4 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-ink">{ok === "restaurada" ? "Versión restaurada (y registrada como versión nueva)." : "Revisión guardada."}</p>}
      {error && <p className="mb-4 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
        <Card className="p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            <History className="size-4 text-muted" strokeWidth={1.7} /> Versiones
          </h2>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SCOPES.map((s) => (
              <Link
                key={s.id}
                href={`/configuracion/agente?scope=${s.id}`}
                className={cn("inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium", s.id === scope ? "bg-primary text-white" : "border border-line bg-card text-muted hover:text-ink")}
              >
                {s.label}
              </Link>
            ))}
          </div>
          {versions.length === 0 ? (
            <p className="mt-4 text-[13px] text-muted">Sin versiones todavía: se registra una cada vez que se guarda la configuración de este canal.</p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {versions.map((v, i) => {
                const snap = v.snapshot as Record<string, unknown>;
                return (
                  <li key={v.id} className="py-3 text-[13px]">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">v{v.version}</span>
                      <span className="text-muted">{v.createdAt.toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</span>
                      {i === 0 && <span className="rounded-full bg-accent-green/10 px-2 py-0.5 text-[11px] text-accent-green">actual</span>}
                    </div>
                    <p className="mt-0.5 text-muted">
                      {snap.enabled === true ? "Encendido" : "Apagado"} · envío {String(snap.autoReply ?? "heredado")} · modelo {String(snap.model ?? "por defecto")}
                      {v.note ? ` · ${v.note}` : ""}
                    </p>
                    {typeof snap.systemPrompt === "string" && snap.systemPrompt && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-[12px] text-primary">Ver instrucciones</summary>
                        <p className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-field p-2 text-[12px] whitespace-pre-wrap text-ink">{snap.systemPrompt}</p>
                      </details>
                    )}
                    {i > 0 && (
                      <form action={restoreAgentVersion} className="mt-1.5">
                        <input type="hidden" name="scope" value={scope} />
                        <input type="hidden" name="versionId" value={v.id} />
                        <Button type="submit" variant="secondary">Restaurar esta versión</Button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-4 text-[12px] text-muted">
            Antes de prender un cambio en un canal con clientes reales, probalo en el Laboratorio con conversaciones de ejemplo: corre el agente real sin enviar nada.
          </p>
        </Card>

        <div className="grid content-start gap-5">
          <Card className="p-6">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <MessageSquareWarning className="size-4 text-muted" strokeWidth={1.7} /> Respuestas reportadas ({pending.length})
            </h2>
            <p className="mt-1 text-[12.5px] text-muted">
              Desde la bandeja, cualquier persona puede tocar «Reportar» en una respuesta del agente. Escribí cómo debió responder y aprobala como ejemplo, o marcala revisada. {totalProblems} en total.
            </p>
            {pending.length === 0 ? (
              <EmptyState icon={MessageSquareWarning} title="Sin reportes pendientes" description="Cuando el equipo reporte una respuesta, aparece acá." className="py-10" />
            ) : (
              <ul className="mt-4 grid gap-4">
                {pending.map((f) => (
                  <li key={f.id} className="rounded-xl border border-line p-4 text-[13px]">
                    {f.customerText && (
                      <p className="text-muted">
                        <span className="font-medium text-ink">Cliente:</span> {f.customerText}
                      </p>
                    )}
                    <p className="mt-1 text-muted">
                      <span className="font-medium text-ink">Respondió el agente:</span> {f.botText}
                    </p>
                    {f.note && <p className="mt-1 text-accent-red">Motivo: {f.note}</p>}
                    {f.conversationId && (
                      <Link href={`/conversaciones/${f.conversationId}`} className="mt-1 inline-block text-[12px] text-primary hover:underline">
                        Ver conversación
                      </Link>
                    )}
                    <form action={reviewFeedbackAction} className="mt-3 grid gap-2">
                      <input type="hidden" name="id" value={f.id} />
                      <textarea name="correctedText" rows={3} maxLength={2000} placeholder="Cómo tendría que haber respondido (sin precios ni datos de propiedades: esos salen siempre del catálogo)" className={field} />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" name="decision" value="ejemplo">Aprobar como ejemplo</Button>
                        <Button type="submit" name="decision" value="revisado" variant="secondary">Marcar revisada</Button>
                        <Button type="submit" name="decision" value="descartado" variant="secondary">Descartar</Button>
                      </div>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-[15px] font-semibold text-ink">Ejemplos aprobados en uso ({approvedExamples.length})</h2>
            <p className="mt-1 text-[12.5px] text-muted">Los 5 más recientes se suman al prompt de esta inmobiliaria como guía de tono. Nunca se usan en otra.</p>
            {approvedExamples.length > 0 && (
              <ul className="mt-3 divide-y divide-line text-[13px]">
                {approvedExamples.slice(0, 10).map((e) => (
                  <li key={e.id} className="py-2">
                    <p className="text-muted">Cliente: {e.customerText}</p>
                    <p className="text-ink">Respuesta: {e.correctedText}</p>
                    <form action={reviewFeedbackAction} className="mt-1">
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" name="decision" value="descartado" className="text-[12px] text-muted hover:text-accent-red">
                        Dejar de usar
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
