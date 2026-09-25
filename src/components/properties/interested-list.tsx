import Link from "next/link";
import { GitBranch, MessageCircle, Users } from "lucide-react";
import { EmptyState } from "@/components/ui/primitives";
import { formatListDate } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/pipeline";
import { TEMPERATURE_META as TEMP } from "@/lib/crm/tag-labels";
import type { LeadTemperature } from "@/db/schema";
import { cn } from "@/lib/utils";

/**
 * Interesados en una propiedad, ordenados por temperatura.
 * Es la lista que mira un asesor para decidir a quién llamar primero, así que lo primero que
 * se lee es el estado y el presupuesto, no el nombre.
 */

type Interested = {
  dealId: string;
  contactId: string;
  contactName: string | null;
  contactPhone: string | null;
  temperature: LeadTemperature | null;
  interest: LeadTemperature | null;
  priceMin: number | null;
  priceMax: number | null;
  currency: string | null;
  urgency: string | null;
  stage: string;
  status: string;
  conversationId: string | null;
  lastContactAt: string | null;
  lastInterestAt: string | null;
  shownAt: string;
};

function presupuesto(i: Interested) {
  const moneda = i.currency ?? "USD";
  const fmt = (n: number) => `${moneda} ${n.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
  if (i.priceMax !== null && i.priceMin !== null) return `${fmt(i.priceMin)} a ${fmt(i.priceMax)}`;
  if (i.priceMax !== null) return `hasta ${fmt(i.priceMax)}`;
  if (i.priceMin !== null) return `desde ${fmt(i.priceMin)}`;
  return null;
}

export function InterestedList({ items }: { items: Interested[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Todavía nadie preguntó por esta propiedad"
        description="Cuando un contacto consulte por ella, aparece acá con su presupuesto y qué tan cerca está de avanzar."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {items.map((i) => {
        // La temperatura del interés en ESTA propiedad manda; si no hay, la general del contacto.
        const temp = i.interest ?? i.temperature;
        const meta = temp ? TEMP[temp] : null;
        const budget = presupuesto(i);

        return (
          <li key={i.dealId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
            <span className={cn("size-2 shrink-0 rounded-full", meta?.dot ?? "bg-line")} />

            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">
                {i.contactName ?? "Sin nombre"}
              </span>
              <span className="block truncate text-[12px] text-muted">
                {i.contactPhone ?? "Sin teléfono"}
                {" · "}
                {STAGE_LABEL[i.stage as keyof typeof STAGE_LABEL] ?? i.stage}
                {i.status !== "abierta" && ` · ${i.status}`}
              </span>
            </span>

            <span className="shrink-0 text-right">
              <span className="block text-[13px] tabular-nums text-ink">
                {budget ?? <span className="text-muted">Sin presupuesto</span>}
              </span>
              {i.urgency && <span className="block text-[11.5px] text-muted">Urgencia: {i.urgency}</span>}
            </span>

            <span className={cn("w-20 shrink-0 text-right text-[12.5px] font-medium", meta?.text ?? "text-muted")}>
              {meta?.label ?? "Sin clasificar"}
            </span>

            <span className="w-24 shrink-0 text-right text-[12px] text-muted">
              {i.lastContactAt ? formatListDate(i.lastContactAt) : formatListDate(i.shownAt)}
            </span>

            <span className="flex shrink-0 gap-1">
              {i.conversationId && (
                <Link
                  href={`/conversaciones/${i.conversationId}`}
                  title="Abrir la conversación"
                  className="grid size-8 place-items-center rounded-md text-muted hover:bg-field hover:text-ink"
                >
                  <MessageCircle className="size-4" strokeWidth={1.7} />
                </Link>
              )}
              <Link
                href={`/pipeline/${i.dealId}`}
                title="Abrir la oportunidad"
                className="grid size-8 place-items-center rounded-md text-muted hover:bg-field hover:text-ink"
              >
                <GitBranch className="size-4" strokeWidth={1.7} />
              </Link>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
