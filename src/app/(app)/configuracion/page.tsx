import Link from "next/link";
import { Bot, CheckCircle2, Settings2 } from "lucide-react";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { agentConfigs } from "@/db/schema";
import { DEFAULT_MODEL, DEFAULT_SYSTEM_PROMPT, mergeAgentConfig } from "@/lib/agent/config";
import { TOOL_LABELS, TOOL_NAMES } from "@/lib/agent/tools";
import { cn } from "@/lib/utils";
import { saveAgentConfig } from "./actions";

type Tab = "global" | Channel;
const TABS: Tab[] = ["whatsapp", "instagram", "facebook", "global"];

export default async function ConfiguracionPage({ searchParams }: PageProps<"/configuracion">) {
  const params = await searchParams;
  const tab: Tab = TABS.includes(params.tab as Tab) ? (params.tab as Tab) : "whatsapp";
  const saved = params.saved === "1";

  const rows = await getDb().select().from(agentConfigs);
  const row = rows.find((r) => r.scope === tab);
  const globalRow = rows.find((r) => r.scope === "global");
  const isGlobal = tab === "global";

  // Lo que el canal hereda si deja un campo vacío.
  const inherited = isGlobal
    ? { systemPrompt: DEFAULT_SYSTEM_PROMPT, model: DEFAULT_MODEL() }
    : mergeAgentConfig(undefined, globalRow);
  const tools = row?.enabledTools ?? (isGlobal ? [...TOOL_NAMES] : mergeAgentConfig(undefined, globalRow).tools);

  return (
    <>
      <PageHeader title="Configuración" subtitle="Agente de IA por canal: prompt, herramientas, modelo e interruptor" />

      <div className="mb-5 flex gap-1.5">
        {TABS.map((t) => {
          const active = t === tab;
          const on = rows.find((r) => r.scope === t)?.enabled;
          const meta = t === "global" ? null : CHANNEL_META[t];
          return (
            <Link
              key={t}
              href={`/configuracion?tab=${t}`}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13.5px] font-medium transition-colors",
                active ? "bg-primary text-white" : "border border-line bg-card text-muted hover:text-ink",
              )}
            >
              {meta ? <meta.Icon className={cn("size-4", active ? "text-white" : meta.color)} /> : <Settings2 className="size-4" strokeWidth={1.7} />}
              {meta?.label ?? "General"}
              {meta && <span className={cn("size-1.5 rounded-full", on ? "bg-accent-green" : "bg-muted/40")} />}
            </Link>
          );
        })}
      </div>

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
                Modelo de OpenAI
              </label>
              <p className="mb-3 text-[13px] text-muted">{isGlobal ? "Vacío usa OPENAI_MODEL." : "Vacío hereda el de General."}</p>
              <input
                id="model"
                name="model"
                defaultValue={row?.model ?? ""}
                placeholder={inherited.model}
                className="h-10 w-full rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none"
              />
            </div>

            <fieldset>
              <legend className="text-[15px] font-semibold text-ink">Herramientas</legend>
              <p className="mb-3 text-[13px] text-muted">Qué puede hacer el agente además de responder.</p>
              {TOOL_NAMES.map((t) => (
                <label key={t} className="flex items-start gap-3 rounded-lg border border-line p-3">
                  <input type="checkbox" name="tools" value={t} defaultChecked={tools.includes(t)} className="mt-0.5 size-4 accent-[var(--color-primary)]" />
                  <span>
                    <span className="block text-[13.5px] font-medium text-ink">{TOOL_LABELS[t].label}</span>
                    <span className="block text-[12.5px] text-muted">{TOOL_LABELS[t].description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
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
