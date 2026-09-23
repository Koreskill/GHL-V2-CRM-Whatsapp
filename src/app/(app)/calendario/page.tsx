import { CalendarDays, ExternalLink } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Calendario · Setter CRM" };

// Solo https: el valor va a un iframe.
function calcomUrl() {
  const raw = process.env.CALCOM_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export default function CalendarioPage() {
  const url = calcomUrl();
  const embed = url ? new URL(url) : null;
  if (embed) {
    embed.searchParams.set("embed", "true");
    embed.searchParams.set("theme", "light");
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Calendario"
        subtitle="Agenda de visitas y reuniones con Cal.com"
        actions={
          url && (
            <a
              href={url.toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
            >
              <ExternalLink className="size-4" strokeWidth={1.7} /> Abrir en Cal.com
            </a>
          )
        }
      />

      {embed ? (
        <Card className="min-h-[640px] flex-1 overflow-hidden">
          <iframe src={embed.toString()} title="Calendario de Cal.com" className="size-full min-h-[640px] border-0" loading="lazy" />
        </Card>
      ) : (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Calendario sin conectar"
            description={
              <>
                Agrega la variable <code className="rounded bg-field px-1.5 py-0.5 text-[12px] text-ink">CALCOM_URL</code> con el link
                de tu agenda (por ejemplo <span className="text-ink">https://cal.com/tu-usuario</span>) y reinicia la app.
              </>
            }
            className="py-24"
          />
        </Card>
      )}
    </div>
  );
}
