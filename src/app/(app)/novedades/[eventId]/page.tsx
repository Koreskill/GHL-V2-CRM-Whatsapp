import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, MapPin } from "lucide-react";
import { EventForm } from "@/components/news/event-form";
import { TypeChip, whenLabel } from "@/components/news/parts";
import { Button, Card, PageHeader } from "@/components/ui/primitives";
import { getDb } from "@/db";
import { networks } from "@/db/schema";
import { getOrganization, listOrganizations } from "@/lib/agency/queries";
import { isUuid } from "@/lib/api";
import { getSession } from "@/lib/auth";
import { SCOPE_LABEL, canManage } from "@/lib/news/logic";
import { getVisibleEvent, viewerFor } from "@/lib/news/queries";
import { deleteNewsEvent, updateNewsEvent } from "../actions";

export default async function EventoPage({ params, searchParams }: PageProps<"/novedades/[eventId]">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { eventId } = await params;
  if (!isUuid(eventId)) notFound();
  const viewer = await viewerFor(session);
  // Un evento que no se puede ver responde igual que uno inexistente: no se filtra que existe.
  const event = await getVisibleEvent(viewer, eventId);
  if (!event) notFound();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;

  const manage = canManage(viewer);
  const clientName = event.organizationId ? ((await getOrganization(event.organizationId))?.name ?? null) : null;
  const [nets, orgs] = manage ? await Promise.all([getDb().select({ id: networks.id, name: networks.name }).from(networks).orderBy(networks.name), listOrganizations()]) : [[], []];
  const occurrence = { event, startAt: event.startAt, endAt: event.endAt, key: event.id };

  return (
    <>
      <PageHeader
        title={event.title}
        subtitle={`${SCOPE_LABEL[event.scope]}${clientName ? ` · ${clientName}` : ""}`}
        actions={
          <Link href="/novedades" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            <ArrowLeft className="size-4" strokeWidth={1.7} /> Novedades
          </Link>
        }
      />
      {sp.guardado === "1" && <p className="mb-5 rounded-lg bg-accent-green/10 px-3 py-2 text-[13px] text-accent-green">Cambios guardados.</p>}
      {error && <p className="mb-5 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}

      <Card className="mb-5 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <TypeChip type={event.eventType} />
          <span className="text-[13px] text-ink">{whenLabel(occurrence)}</span>
          {event.recurrence !== "none" && <span className="text-[12px] text-muted">· se repite ({event.recurrence})</span>}
        </div>
        {event.location && (
          <p className="mt-3 flex items-center gap-1.5 text-[13.5px] text-ink">
            <MapPin className="size-4 text-muted" strokeWidth={1.8} /> {event.location}
          </p>
        )}
        {event.meetingUrl && (
          <a href={event.meetingUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-medium text-primary hover:underline">
            <ExternalLink className="size-4" strokeWidth={1.8} /> Unirse a la reunión
          </a>
        )}
        {event.description && <p className="mt-4 text-[14px] leading-relaxed whitespace-pre-line text-ink">{event.description}</p>}
      </Card>

      {manage && (
        <>
          <Card className="mb-5 p-6">
            <h2 className="mb-4 text-[15px] font-semibold text-ink">Editar</h2>
            <EventForm action={updateNewsEvent} event={event} networks={nets} clients={orgs.map((o) => ({ id: o.id, name: o.name }))} submitLabel="Guardar cambios" />
          </Card>
          <form action={deleteNewsEvent}>
            <input type="hidden" name="id" value={event.id} />
            <Button type="submit" variant="secondary">
              Eliminar evento
            </Button>
          </form>
        </>
      )}
    </>
  );
}
