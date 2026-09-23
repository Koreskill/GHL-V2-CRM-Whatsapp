import { FileText, Plus, RefreshCw } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";

export default function PlantillasPage() {
  return (
    <>
      <PageHeader
        title="Plantillas de WhatsApp"
        subtitle="Mensajes preaprobados por Meta para escribir fuera de la ventana de 24h"
        actions={
          <>
            <Button variant="secondary">
              <RefreshCw className="size-4" strokeWidth={1.7} /> Sincronizar
            </Button>
            <Button>
              <Plus className="size-4" strokeWidth={2} /> Nueva plantilla
            </Button>
          </>
        }
      />
      <Card>
        <EmptyState
          icon={FileText}
          title="Todavia no hay plantillas"
          description="Crea tu primera plantilla. Meta la revisa y, una vez aprobada, vas a poder enviarla desde cualquier conversación."
          className="py-24"
        />
      </Card>
    </>
  );
}
