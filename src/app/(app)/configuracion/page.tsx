import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { Bot, CheckCircle2, Link2, Settings2 } from "lucide-react";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { AccountsPanel } from "@/components/settings/accounts-panel";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { agentConfigs, channelAccounts } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, mergeAgentConfig } from "@/lib/agent/config";
import { cn } from "@/lib/utils";
import { saveAgentConfig } from "./actions";

type AgentTab = "global" | Channel;
type Tab = "cuentas" | AgentTab;
const TABS: Tab[] = ["cuentas", "whatsapp", "instagram", "facebook", "global"];

export default async function ConfiguracionPage({ searchParams }: PageProps<"/configuracion">) {
  // Solo administradores: la validación es del servidor, no solo ocultar el link del menú.
  const session = await requireRole("admin");
  if (!session) redirect("/");
  const orgId = session.organizationId;

  const params = await searchParams;
  const tab: Tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : "cuentas";
  const saved = params.saved === "1";

  const db = getDb();
  const rows = await db.select().from(agentConfigs).where(eq(agentConfigs.organizationId, orgId));

  const tabs = (
    <div className="mb-5 flex gap-1.5">
      {TABS.map((t) => {
        const active = t === tab;
        const on = rows.find((r) => r.scope === t)?.enabled;
        const meta = t === "global" || t === "cuentas" ? null : CHANNEL_META[t];
        const TabIcon = t === "cuentas" ? Link2 : Settings2;
        return (
          <Link
            key={t}
            href={`/configuracion?tab=${t}`}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13.5px] font-medium transition-colors",
              active ? "bg-primary text-white" : "border border-line bg-card text-muted hover:text-ink",
            )}
          >
            {meta ? <meta.Icon className={cn("size-4", active ? "text-white" : meta.color)} /> : <TabIcon className="size-4" strokeWidth={1.7} />}
            {meta ? `Agente ${meta.label}` : t === "cuentas" ? "Cuentas" : "Agente general"}
            {meta && <span className={cn("size-1.5 rounded-full", on ? "bg-accent-green" : "bg-muted/40")} />}
          </Link>
        );
      })}
    </div>
  );

  if (tab === "cuentas") {
    const accounts = await db
      .select()
      .from(channelAccounts)
      .where(eq(channelAccounts.organizationId, orgId))
      .orderBy(channelAccounts.createdAt);
    return (
      <>
        <PageHeader title="Configuración" subtitle="Cuentas conectadas por Zernio y agente de IA por canal" />
        {tabs}
        <AccountsPanel
          accounts={accounts.map((a) => ({
            id: a.id,
            channel: a.channel,
            name: a.name,
            handle: a.handle,
            status: a.status,
            historyImportedAt: a.historyImportedAt?.toISOString() ?? null,
          }))}
        />
      </>
    );
  }
  const row = rows.find((r) => r.scope === tab);
  const globalRow = rows.find((r) => r.scope === "global");
  const isGlobal = tab === "global";

  // Lo que el canal hereda si deja un campo vacío.
  const inherited = isGlobal
    ? { systemPrompt: DEFAULT_SYSTEM_PROMPT, model: DEFAULT_MODEL() }
    : mergeAgentConfig(undefined, globalRow);

  return (
    <>
      <PageHeader title="Configuración" subtitle="Cuentas conectadas por Zernio y agente de IA por canal" />
      {tabs}

      <form action={saveAgentConfig}>
        <input type="hidden" name="scope" value={tab} />
        <Card className="divide-y divide-line">
          {!isGlobal && (
            <div className="flex items-center gap-4 p-6">
              <span className="grid size-10 place-items-center rounded-full bg-field text-muted">
                <Bot className="size-5" strokeWidth={1.6} />
              </span>
              <div className="flex-1">
                <p className="text-[15px] font-semibold text-ink">Agente activo en {CHANNEL_META[tab].label}</p>
                <p className="text-[13px] text-muted">
                  Apagado, nadie recibe respuestas automáticas por este canal. Cada conversación además se puede pausar desde la bandeja.
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" name="enabled" defaultChecked={row?.enabled ?? false} className="peer sr-only" />
                <span className="h-6 w-11 rounded-full bg-line transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/30" />
                <span className="absolute left-0.5 size-5 rounded-full bg-white shadow-card transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
          )}

          <div className="p-6">
            <label htmlFor="systemPrompt" className="text-[15px] font-semibold text-ink">
              Prompt del sistema
            </label>
            <p className="mb-3 text-[13px] text-muted">
              {isGlobal
                ? "Base para los canales que no tengan uno propio. Vacío usa el prompt por defecto."
                : "Vacío hereda el de General."}
            </p>
            <textarea
              id="systemPrompt"
              name="systemPrompt"
              defaultValue={row?.systemPrompt ?? ""}
              placeholder={inherited.systemPrompt}
              rows={10}
              className="w-full rounded-xl border border-line bg-field px-4 py-3 text-[13.5px] leading-relaxed text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none"
            />
          </div>

          <div className="grid gap-6 p-6 md:grid-cols-2">
            <div>
              <label htmlFor="model" className="text-[15px] font-semibold text-ink">
                Modelo de IA (OpenRouter)
              </label>
              <p className="mb-3 text-[13px] text-muted">
                {isGlobal ? "Slug de OpenRouter (ej. openai/gpt-4.1-mini). Vacío usa OPENROUTER_MODEL." : "Vacío hereda el de General."}
              </p>
              <input
                id="model"
                name="model"
                defaultValue={row?.model ?? ""}
                placeholder={inherited.model}
                className="h-10 w-full rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none"
              />
            </div>

            <div>
              <p className="text-[15px] font-semibold text-ink">Derivación a una persona</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                Es automática: el clasificador evalúa cada mensaje y, ante un reclamo, un pedido de hablar con
                alguien, un asunto delicado o poca certeza, prepara un borrador y pausa la IA en esa
                conversación en vez de responder. El umbral se ajusta más abajo.
              </p>
            </div>
          </div>

          {/* Política de respuesta automática. Los umbrales viven acá, no repartidos por el
              código: son decisión de cada inmobiliaria y se calibran con mensajes reales. */}
          <div className="p-6">
            <p className="text-[15px] font-semibold text-ink">Respuesta automática</p>
            <p className="mb-4 text-[13px] text-muted">
              Antes de responder, un modelo clasifica el mensaje y el sistema elige el flujo. Un reclamo o un
              pedido de hablar con una persona nunca reciben respuesta automática.
            </p>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label htmlFor="autoReply" className="block text-[13.5px] font-medium text-ink">
                  Modo de envío
                </label>
                <select
                  id="autoReply"
                  name="autoReply"
                  defaultValue={row?.autoReply ?? ""}
                  className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none"
                >
                  <option value="">{isGlobal ? "Automático (por defecto)" : "Heredar de General"}</option>
                  <option value="auto">Automático: responde solo</option>
                  <option value="borrador">Borrador: prepara y espera revisión</option>
                  <option value="off">Apagado: no redacta nada</option>
                </select>
              </div>

              <div>
                <label htmlFor="decisionModel" className="block text-[13.5px] font-medium text-ink">
                  Modelo de clasificación
                </label>
                <input
                  id="decisionModel"
                  name="decisionModel"
                  defaultValue={row?.decisionModel ?? ""}
                  placeholder="typesafe/jev-1.13"
                  className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none"
                />
                <p className="mt-1.5 text-[12px] text-muted">
                  Usa la Decisions API, no la de chat. Vacío usa OPENROUTER_DECISION_MODEL.
                </p>
              </div>

              <div>
                <label htmlFor="minConfidence" className="block text-[13.5px] font-medium text-ink">
                  Confianza mínima
                </label>
                <input
                  id="minConfidence"
                  name="minConfidence"
                  inputMode="decimal"
                  defaultValue={row?.minConfidence ?? ""}
                  placeholder="0.60"
                  className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none"
                />
                <p className="mt-1.5 text-[12px] text-muted">
                  Entre 0 y 1. Por debajo, el agente pide una aclaración en vez de suponer qué necesita.
                </p>
              </div>

              <div>
                <label htmlFor="humanThreshold" className="block text-[13.5px] font-medium text-ink">
                  Umbral de derivación
                </label>
                <input
                  id="humanThreshold"
                  name="humanThreshold"
                  inputMode="decimal"
                  defaultValue={row?.humanThreshold ?? ""}
                  placeholder="0.50"
                  className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none"
                />
                <p className="mt-1.5 text-[12px] text-muted">
                  Cuánta señal de «esto lo tiene que ver una persona» alcanza para derivar. Más bajo, más cauto.
                </p>
              </div>
            </div>

            <p className="mt-4 rounded-lg bg-field px-3 py-2 text-[12.5px] leading-relaxed text-muted">
              Los valores por defecto (0.60 y 0.50) son un punto de partida, no un número calibrado. Para
              ajustarlos con mensajes reales de esta inmobiliaria:{" "}
              <code className="text-[12px]">npx tsx scripts/triage-calibrar.ts mensajes.json</code>
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 p-4">
            {saved && (
              <span className="mr-auto flex items-center gap-1.5 text-[13px] text-accent-green">
                <CheckCircle2 className="size-4" /> Cambios guardados
              </span>
            )}
            <Button type="submit">Guardar cambios</Button>
          </div>
        </Card>
      </form>
    </>
  );
}
