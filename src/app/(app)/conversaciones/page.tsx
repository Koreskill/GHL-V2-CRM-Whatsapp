import { MessageCircle, Search } from "lucide-react";
import { Card, EmptyState } from "@/components/ui/primitives";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { cn } from "@/lib/utils";

const channels: Channel[] = ["whatsapp", "instagram", "facebook"];

export default function ConversacionesPage() {
  return (
    <div className="-mx-9 -my-8 flex h-[calc(100%+4rem)]">
      <section className="flex w-[360px] shrink-0 flex-col border-r border-line bg-card">
        <div className="border-b border-line p-5">
          <div className="flex items-center gap-2">
            <h1 className="text-[18px] font-semibold text-ink">Conversaciones</h1>
            <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">0</span>
          </div>
          <label className="mt-4 flex h-9 items-center gap-2 rounded-lg bg-field px-3 text-muted">
            <Search className="size-4" strokeWidth={1.8} />
            <input
              type="search"
              placeholder="Buscar por nombre, usuario o teléfono"
              className="flex-1 bg-transparent text-[13px] text-ink placeholder:text-muted focus:outline-none"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip active>Todos</Chip>
            {channels.map((c) => {
              const { label, Icon, color } = CHANNEL_META[c];
              return (
                <Chip key={c}>
                  <Icon className={cn("size-3.5", color)} />
                  {label}
                </Chip>
              );
            })}
          </div>
        </div>
        <EmptyState
          icon={MessageCircle}
          title="Aun no hay conversaciones."
          description="Cuando alguien te escriba por WhatsApp, Instagram o Messenger, va a aparecer acá."
          className="flex-1"
        />
      </section>

      <section className="grid flex-1 place-items-center p-8">
        <Card className="border-none bg-transparent shadow-none">
          <EmptyState
            icon={MessageCircle}
            title="Selecciona una conversación"
            description={
              <>
                <p>
                  Los mensajes de WhatsApp, Instagram y Messenger aparecen a la izquierda. Tocar
                  cualquiera para ver el historial y responder.
                </p>
                <p className="mt-3 text-[12.5px] text-muted/80">
                  Fuera de la ventana de 24 horas, WhatsApp solo admite plantillas aprobadas.
                </p>
              </>
            }
          />
        </Card>
      </section>
    </div>
  );
}

function Chip({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium",
        active ? "bg-primary text-white" : "bg-field text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
