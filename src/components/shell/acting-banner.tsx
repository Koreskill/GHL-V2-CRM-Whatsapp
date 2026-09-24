import { Building2, LogOut } from "lucide-react";
import { exitClient } from "@/app/(app)/agencia/actions";

/**
 * Barra que deja claro en TODAS las pantallas sobre qué inmobiliaria se está trabajando.
 * Sin esto, el admin de la agencia podría cargar una oportunidad creyendo que está en su propio
 * espacio. Se muestra solo cuando está dentro del espacio de un cliente.
 */
export function ActingBanner({ clientName }: { clientName: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-primary/25 bg-primary/10 px-9 py-2">
      <Building2 className="size-4 shrink-0 text-primary" strokeWidth={1.8} />
      <p className="min-w-0 flex-1 text-[13px] text-ink">
        Estás trabajando en <span className="font-semibold">{clientName}</span>. Todo lo que hagas queda
        registrado como tu usuario de agencia.
      </p>
      <form action={exitClient}>
        <button
          type="submit"
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-primary/30 bg-card px-2.5 text-[12.5px] font-medium text-primary hover:bg-primary/5"
        >
          <LogOut className="size-3.5" strokeWidth={1.8} />
          Volver a Agencia
        </button>
      </form>
    </div>
  );
}
