import { MessageCircle } from "lucide-react";
import { ConversationList } from "@/components/inbox/conversation-list";
import { parseInboxFilters } from "@/components/inbox/filters";
import { EmptyState } from "@/components/ui/primitives";
import { requireOrgId } from "@/lib/auth";
import { loadInboxSidebar } from "@/lib/inbox/sidebar";

export default async function ConversacionesPage({ searchParams }: PageProps<"/conversaciones">) {
  const orgId = await requireOrgId();
  const filters = parseInboxFilters(await searchParams);
  const { items, counts, delegations } = await loadInboxSidebar(orgId, filters);
  const error = typeof (await searchParams).error === "string" ? String((await searchParams).error) : null;

  return (
    <div className="-mx-9 -my-8 flex h-[calc(100%+4rem)]">
      <ConversationList items={items} counts={counts} delegations={delegations} filters={filters} />
      <section className="grid flex-1 place-items-center p-8">
        {error && <p role="alert" className="absolute top-20 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{error}</p>}
        <EmptyState
          icon={MessageCircle}
          title="Selecciona una conversación"
          description={
            <>
              <p>
                Los mensajes de WhatsApp, Instagram y Messenger aparecen a la izquierda. Tocar cualquiera para ver el
                historial y responder.
              </p>
              <p className="mt-3 text-[12.5px] text-muted/80">
                Fuera de la ventana de 24 horas, WhatsApp solo admite plantillas aprobadas.
              </p>
            </>
          }
        />
      </section>
    </div>
  );
}
