"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, Handshake, PowerOff, Power } from "lucide-react";
import { changeConversationStatus, delegateConversationAction } from "@/app/(app)/conversaciones/actions";
import { cn } from "@/lib/utils";

const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-[12.5px] font-medium text-muted transition-colors hover:text-ink";

/** Estado operativo del hilo y delegación a la red. El estado NO es la pausa del bot: son interruptores distintos. */
export function ConversationActions({
  conversationId,
  status,
  delegation,
  canDelegate,
}: {
  conversationId: string;
  status: string;
  delegation: { id: string; status: string } | null;
  canDelegate: boolean;
}) {
  const [delegating, setDelegating] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const pending = delegation?.status === "pendiente";

  const statusForm = (next: string, label: string, Icon: typeof Power) => (
    <form action={changeConversationStatus}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <input type="hidden" name="status" value={next} />
      <button type="submit" className={btn} title={label}>
        <Icon className="size-3.5" strokeWidth={1.8} />
        {label}
      </button>
    </form>
  );

  return (
    <div className="relative flex items-center gap-1.5">
      {status === "activa" && statusForm("desactiva", "Desactivar", PowerOff)}
      {status === "desactiva" && statusForm("activa", "Activar", Power)}
      {status === "archivada" && statusForm("activa", "Restaurar", ArchiveRestore)}

      {status !== "archivada" &&
        (confirmArchive ? (
          <form action={changeConversationStatus} className="flex items-center gap-1.5">
            <input type="hidden" name="conversationId" value={conversationId} />
            <input type="hidden" name="status" value="archivada" />
            <button type="submit" className={cn(btn, "border-accent-red/40 text-accent-red")}>
              Confirmar
            </button>
            <button type="button" className={btn} onClick={() => setConfirmArchive(false)}>
              No
            </button>
          </form>
        ) : (
          <button type="button" className={btn} onClick={() => setConfirmArchive(true)} title="Archivar: se oculta, no se borra, y se puede restaurar">
            <Archive className="size-3.5" strokeWidth={1.8} />
            Archivar
          </button>
        ))}

      {pending ? (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-amber/12 px-2.5 text-[12.5px] font-medium text-accent-amber">
          <Handshake className="size-3.5" strokeWidth={1.8} /> Delegación pendiente
        </span>
      ) : delegation?.status === "tomada" ? (
        <span className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent-green/12 px-2.5 text-[12.5px] font-medium text-accent-green">
          <Handshake className="size-3.5" strokeWidth={1.8} /> Delegada
        </span>
      ) : (
        canDelegate && (
          <button type="button" className={btn} onClick={() => setDelegating((v) => !v)} aria-expanded={delegating}>
            <Handshake className="size-3.5" strokeWidth={1.8} />
            Delegar
          </button>
        )
      )}

      {delegating && (
        <form
          action={delegateConversationAction}
          className="absolute top-10 right-0 z-20 grid w-80 gap-2.5 rounded-xl border border-line bg-card p-4 shadow-card"
        >
          <input type="hidden" name="conversationId" value={conversationId} />
          <p className="text-[13px] font-semibold text-ink">Delegar a la red</p>
          <p className="text-[12px] text-muted">
            Otra inmobiliaria de tu red podrá tomarla. Antes de tomarla solo ve un resumen: sin mensajes ni datos de contacto.
          </p>
          <textarea name="note" rows={2} maxLength={500} placeholder="Nota para quien la tome (opcional)" className="rounded-lg border border-line bg-field px-3 py-2 text-[12.5px] text-ink focus:border-primary focus:outline-none" />
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" name="history" className="size-4 accent-[var(--color-primary)]" /> Compartir el historial de mensajes
          </label>
          <label className="flex items-center gap-2 text-[12.5px] text-ink">
            <input type="checkbox" name="phone" className="size-4 accent-[var(--color-primary)]" /> Compartir el teléfono
          </label>
          <div className="flex gap-2">
            <button type="submit" className="h-8 rounded-lg bg-primary px-3 text-[12.5px] font-medium text-white hover:bg-primary-hover">
              Enviar solicitud
            </button>
            <button type="button" onClick={() => setDelegating(false)} className={btn}>
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
