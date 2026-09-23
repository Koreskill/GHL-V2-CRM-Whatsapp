import { Activity, BarChart3, DollarSign, TrendingUp, Users, Workflow } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { PIPELINE_STAGES } from "@/lib/pipeline";

type Metric = { label: string; value: string; growth: string; icon: LucideIcon; tone: string };

const metrics: Metric[] = [
  { label: "Total Contactos", value: "3", growth: "12%", icon: Users, tone: "text-accent-cyan" },
  { label: "Deals Activos", value: "0", growth: "8%", icon: Workflow, tone: "text-accent-purple" },
  { label: "Valor en Pipeline", value: "$0.00", growth: "15%", icon: DollarSign, tone: "text-accent-green" },
  { label: "Tasa de Conversión", value: "0%", growth: "5%", icon: BarChart3, tone: "text-accent-amber" },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="Resumen de tu pipeline de ventas" />

      <div className="grid grid-cols-4 gap-5">
        {metrics.map(({ label, value, growth, icon: Icon, tone }) => (
          <Card key={label} className="relative overflow-hidden p-5">
            <p className="text-[13px] font-medium text-muted">{label}</p>
            <p className="mt-2 text-[30px] leading-none font-bold text-ink">{value}</p>
            <p className="mt-3 flex items-center gap-1 text-[12px] text-accent-green">
              <TrendingUp className="size-3.5" strokeWidth={2} />
              {growth} <span className="text-muted">vs mes pasado</span>
            </p>
            <Icon
              className={`absolute top-5 right-5 size-9 opacity-25 ${tone}`}
              strokeWidth={1.3}
            />
          </Card>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-5">
        <Card className="col-span-2 p-6">
          <h2 className="text-[17px] font-semibold text-ink">Pipeline de Ventas</h2>
          <p className="text-[13px] text-muted">Distribución de deals por etapa</p>
          <div className="mt-8 flex h-56 items-end gap-6 border-b border-line px-2">
            {PIPELINE_STAGES.map((stage) => (
              <div key={stage.id} className="flex flex-1 flex-col items-center gap-2">
                <div className={`h-1 w-full rounded-full ${stage.dot} opacity-40`} />
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-6 px-2">
            {PIPELINE_STAGES.map((stage) => (
              <p key={stage.id} className="flex-1 text-center text-[12px] text-muted">
                {stage.label}
              </p>
            ))}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-[17px] font-semibold text-ink">Actividad Reciente</h2>
          <p className="text-[13px] text-muted">Últimos eventos del equipo</p>
          <EmptyState
            icon={Activity}
            title="Sin actividad todavía"
            description="Los eventos del equipo aparecerán acá."
          />
        </Card>
      </div>
    </>
  );
}
