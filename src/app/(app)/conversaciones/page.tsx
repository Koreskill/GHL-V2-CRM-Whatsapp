import { MessageCircle } from "lucide-react";
import { ConversationList } from "@/components/inbox/conversation-list";
import { parseInboxFilters } from "@/components/inbox/filters";
import { EmptyState } from "@/components/ui/primitives";
import { countConversations, listConversations } from "@/lib/inbox/queries";

export default async function ConversacionesPage({ searchParams }: PageProps<"/conversaciones">) {
  const filters = parseInboxFilters(await searchParams);
  const [items, total] = await Promise.all([listConversations(filters), countConversations()]);

  return (
    <div className="-mx-9 -my-8 flex h-[calc(100%+4rem)]">
      <ConversationList items={items} total={total} filters={filters} />
      <section className="grid flex-1 place-items-center p-8">
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
