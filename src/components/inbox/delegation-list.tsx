import { Handshake } from "lucide-react";
import { cancelDelegationAction, takeDelegationAction } from "@/app/(app)/conversaciones/actions";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { EmptyState } from "@/components/ui/primitives";
import { formatListDate } from "@/lib/format";
import type { OpenDelegation } from "@/lib/delegations/flow";
import { cn } from "@/lib/utils";

const OPERATION: Record<string, string> = { venta: "Venta", alquiler: "Alquiler", temporario: "Temporario" };

function describe(summary: Record<string, unknown>) {
  const zones = Array.isArray(summary.zones) ? (summary.zones as string[]) : [];
  const types = Array.isArray(summary.propertyTypes) ? (summary.propertyTypes as string[]) : [];
  const budget = summary.budget as { min: string | null; max: string | null; currency: string } | null;
  return [
    typeof summary.operation === "string" ? OPERATION[summary.operation] : null,
    types.join(", ") || null,
    zones.join(", ") || null,
    budget ? [budget.min, budget.max].filter(Boolean).map((n) => `${budget.currency} ${Number(n).toLocaleString("es-AR")}`).join(" – ") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Solicitudes de la red. Antes de tomarlas solo se ve un resumen: nada de mensajes ni datos de contacto. */
export function DelegationList({ items }: { items: OpenDelegation[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Handshake}
        title="Sin solicitudes de la red"
        description="Cuando otra inmobiliaria de tu red delegue una conversación, aparece acá para que alguien la tome."
      />
    );
  }
  return (
    <ul>
      {items.map((d) => {
        const channel = (typeof d.summary.channel === "string" ? d.summary.channel : "whatsapp") as Channel;
        const { Icon, color, label } = CHANNEL_META[channel];
        return (
          <li key={d.id} className="border-b border-line/70 px-5 py-3.5">
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <Icon className={cn("size-3.5", color)} />
              <span>{label}</span>
              <span className="ml-auto">{formatListDate(d.createdAt)}</span>
            </div>
            <p className="mt-1 text-[13.5px] font-medium text-ink">{d.mine ? "Tu solicitud" : `De ${d.sourceName}`}</p>
            {describe(d.summary) && <p className="text-[12.5px] text-muted">{describe(d.summary)}</p>}
            {d.note && <p className="mt-1 text-[12.5px] text-ink">“{d.note}”</p>}
            <p className="mt-1 text-[11.5px] text-muted">
              Comparte: {d.scope.history ? "historial" : "sin historial"}, {d.scope.phone ? "teléfono" : "sin teléfono"}
            </p>
            {d.mine ? (
              <form action={cancelDelegationAction} className="mt-2">
                <input type="hidden" name="delegationId" value={d.id} />
                <button type="submit" className="h-7 rounded-lg border border-line px-2.5 text-[12px] text-ink hover:bg-field">
                  Cancelar solicitud
                </button>
              </form>
            ) : (
              <form action={takeDelegationAction} className="mt-2">
                <input type="hidden" name="delegationId" value={d.id} />
                <button type="submit" className="h-7 rounded-lg bg-primary px-2.5 text-[12px] font-medium text-white hover:bg-primary-hover">
                  Tomar
                </button>
              </form>
            )}
          </li>
        );
      })}
    </ul>
  );
}
