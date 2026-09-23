import Link from "next/link";
import { eq } from "drizzle-orm";
import { AlertCircle, CheckCircle2, FileText, Plus, RefreshCw } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { listTemplates, templateBody } from "@/lib/zernio/templates";
import type { WhatsAppTemplate } from "@/lib/zernio/types";
import { cn } from "@/lib/utils";

export const metadata = { title: "Plantillas · Setter CRM" };

const STATUS: Record<string, { label: string; tone: string }> = {
  APPROVED: { label: "Aprobada", tone: "bg-accent-green/10 text-accent-green" },
  PENDING: { label: "En revisión", tone: "bg-accent-amber/10 text-accent-amber" },
  REJECTED: { label: "Rechazada", tone: "bg-accent-red/10 text-accent-red" },
};
const CATEGORY: Record<string, string> = { MARKETING: "Marketing", UTILITY: "Utilidad", AUTHENTICATION: "Autenticación" };

const actionClass = "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-medium transition-colors";

export default async function PlantillasPage({ searchParams }: PageProps<"/plantillas">) {
  const params = await searchParams;
  const session = await getSession();
  const isAdmin = session?.role === "admin";

  const accounts = await getDb().select().from(channelAccounts).where(eq(channelAccounts.channel, "whatsapp"));
  const connected = accounts.filter((a) => a.status === "connected");
  const results = await Promise.all(
    connected.map(async (a) => ({ account: a, res: await listTemplates({ accountId: a.externalId }) })),
  );

  return (
    <>
      <PageHeader
        title="Plantillas de WhatsApp"
        subtitle="Mensajes preaprobados por Meta para escribir fuera de la ventana de 24h"
        actions={
          <>
            <Link href="/plantillas" prefetch={false} className={cn(actionClass, "border border-line bg-card text-ink hover:bg-field")}>
              <RefreshCw className="size-4" strokeWidth={1.7} /> Sincronizar
            </Link>
            {isAdmin && connected.length > 0 && (
              <Link href="/plantillas/nueva" className={cn(actionClass, "bg-primary text-white hover:bg-primary-hover")}>
                <Plus className="size-4" strokeWidth={2} /> Nueva plantilla
              </Link>
            )}
          </>
        }
      />

      {typeof params.created === "string" && (
        <p className="mb-5 flex items-center gap-2 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-ink">
          <CheckCircle2 className="size-4 text-accent-green" /> Plantilla enviada a Meta para revisión. Aparece como aprobada cuando Meta la acepta.
        </p>
      )}

      {connected.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title="Sin WhatsApp conectado"
            description="Conecta una cuenta de WhatsApp en Configuración para gestionar sus plantillas."
            className="py-24"
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {results.map(({ account, res }) => (
            <Card key={account.id} className="overflow-hidden">
              {results.length > 1 && (
                <p className="border-b border-line px-6 py-3 text-[13px] font-medium text-muted">{account.handle ?? account.name}</p>
              )}
              {!res.success ? (
                <p className="flex items-center gap-2 px-6 py-5 text-[13px] text-accent-red">
                  <AlertCircle className="size-4" /> No se pudieron leer las plantillas de esta cuenta. Probá sincronizar en unos minutos.
                </p>
              ) : (res.data.templates ?? []).length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="Todavia no hay plantillas"
                  description="Crea tu primera plantilla. Meta la revisa y, una vez aprobada, vas a poder enviarla desde cualquier conversación."
                  className="py-24"
                />
              ) : (
                <TemplateTable templates={res.data.templates ?? []} />
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

function TemplateTable({ templates }: { templates: WhatsAppTemplate[] }) {
  return (
    <table className="w-full text-left text-[13.5px]">
      <thead>
        <tr className="border-b border-line text-[11.5px] font-semibold tracking-wide text-muted uppercase">
          <th className="px-6 py-3 font-semibold">Nombre</th>
          <th className="px-4 py-3 font-semibold">Mensaje</th>
          <th className="px-4 py-3 font-semibold">Categoría</th>
          <th className="px-4 py-3 font-semibold">Idioma</th>
          <th className="px-6 py-3 font-semibold">Estado</th>
        </tr>
      </thead>
      <tbody>
        {templates.map((t) => {
          const status = STATUS[t.status ?? ""] ?? { label: t.status ?? "—", tone: "bg-field text-muted" };
          return (
            <tr key={t.id ?? `${t.name}-${t.language}`} className="border-b border-line/70 align-top last:border-0">
              <td className="px-6 py-3.5 font-medium text-ink">{t.name}</td>
              <td className="max-w-md px-4 py-3.5 text-muted">
                <span className="line-clamp-2 whitespace-pre-wrap">{templateBody(t) || "—"}</span>
              </td>
              <td className="px-4 py-3.5 text-ink">{CATEGORY[t.category ?? ""] ?? t.category ?? "—"}</td>
              <td className="px-4 py-3.5 text-ink">{t.language}</td>
              <td className="px-6 py-3.5">
                <span className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium", status.tone)}>{status.label}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
