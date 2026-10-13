"use client";

import { useActionState } from "react";
import { inviteUserAction, type InviteState } from "@/app/(app)/agencia/actions";

const field = "h-9 rounded-lg border border-line bg-field px-2 text-[13px] text-ink";

// El enlace se muestra UNA vez: en la base solo queda su hash. Sin SMTP configurado lo copia la agencia y se lo pasa.
export function InviteForm({ orgs }: { orgs: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(inviteUserAction, {});
  return (
    <div>
      <form action={action} className="flex flex-wrap items-center gap-2">
        <select name="organizationId" required defaultValue="" className={field}>
          <option value="" disabled>
            Inmobiliaria…
          </option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <input name="email" type="email" required placeholder="email@ejemplo.com" className={`${field} w-56`} />
        <select name="role" defaultValue="agent" className={field}>
          <option value="agent">Agente</option>
          <option value="admin">Administrador</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="h-9 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          Generar invitación
        </button>
      </form>
      {state.error && <p className="mt-2 text-[13px] text-accent-red">{state.error}</p>}
      {state.link && (
        <div className="mt-3 rounded-lg bg-field p-3">
          <p className="text-[12.5px] text-muted">Copia este enlace y envíaselo a la persona. Vale 7 días, se usa una vez y no se vuelve a mostrar.</p>
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} className="mt-2 h-9 w-full rounded-md border border-line bg-card px-2 text-[12.5px] text-ink" />
        </div>
      )}
    </div>
  );
}
