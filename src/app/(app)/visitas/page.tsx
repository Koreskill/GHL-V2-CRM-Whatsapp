import { CalendarClock, Plus } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";

const sections = [
  {
    title: "Visitas coordinadas",
    subtitle: "Con fecha y hora confirmada",
    empty: "No hay visitas coordinadas",
  },
  {
    title: "En proceso de coordinación",
    subtitle: "Pendientes de confirmar fecha con el cliente",
    empty: "No hay visitas en coordinación",
  },
];

export default function VisitasPage() {
  return (
    <>
      <PageHeader
        title="Visitas"
        subtitle="Visitas a propiedades coordinadas y en proceso"
        actions={
          <Button>
            <Plus className="size-4" strokeWidth={2} /> Nueva visita
          </Button>
        }
      />
      <div className="flex flex-col gap-5">
        {sections.map((s) => (
          <Card key={s.title} className="p-6">
            <div className="flex items-center gap-2">
              <h2 className="text-[17px] font-semibold text-ink">{s.title}</h2>
              <span className="rounded-md bg-field px-1.5 py-0.5 text-[11px] font-medium text-muted">0</span>
            </div>
            <p className="text-[13px] text-muted">{s.subtitle}</p>
            <EmptyState
              icon={CalendarClock}
              title={s.empty}
              description="Las visitas que crees aparecerán aquí."
            />
          </Card>
        ))}
      </div>
    </>
  );
}
