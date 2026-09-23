import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { NewTemplateForm } from "@/components/templates/new-template-form";
import { getDb } from "@/db";
import { channelAccounts } from "@/db/schema";
import { requireRole } from "@/lib/auth";

export const metadata = { title: "Nueva plantilla · Setter CRM" };

export default async function NuevaPlantillaPage() {
  if (!(await requireRole("admin"))) redirect("/plantillas");
  const accounts = await getDb()
    .select({ id: channelAccounts.id, label: channelAccounts.handle, name: channelAccounts.name })
    .from(channelAccounts)
    .where(and(eq(channelAccounts.channel, "whatsapp"), eq(channelAccounts.status, "connected")));
  if (accounts.length === 0) redirect("/plantillas");

  return (
    <>
      <PageHeader title="Nueva plantilla" subtitle="Meta la revisa antes de que se pueda enviar. Suele tardar de minutos a unas horas." />
      <NewTemplateForm accounts={accounts.map((a) => ({ id: a.id, label: a.label ?? a.name ?? "WhatsApp" }))} />
    </>
  );
}
