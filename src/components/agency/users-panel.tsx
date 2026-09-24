"use client";

import { useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { addClientUser, removeClientUser, resetClientPassword } from "@/app/(app)/agencia/actions";
import { PasswordField } from "@/components/ui/password-field";
import type { ClientUser } from "@/lib/agency/users";
import { formatListDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Usuarios de un cliente, desde el plano de agencia.
 * Acá NO se muestra ninguna contraseña guardada: Supabase las guarda hasheadas y no hay forma
 * de recuperarlas. Lo que se puede hacer es fijar una nueva y pasársela al cliente.
 */
export function AgencyUsersPanel({
  orgId,
  users,
  currentUserId,
}: {
  orgId: string;
  users: ClientUser[];
  currentUserId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<string | null>(null);

  return (
    <div>
      {users.length === 0 ? (
        <p className="px-5 py-5 text-[13px] text-muted">
          Este cliente no tiene usuarios. Agrega uno para que pueda entrar.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="px-5 py-3.5">
              <div className="flex items-center gap-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{u.email}</span>
                  <span className="block text-[12px] text-muted">
                    {u.role === "admin" ? "Administrador" : u.role === "agent" ? "Agente" : "Sin rol"}
                    {" · "}
                    {u.lastSignInAt ? `entró ${formatListDate(u.lastSignInAt)}` : "nunca entró"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setResetting((id) => (id === u.id ? null : u.id))}
                  title="Cambiar contraseña"
                  className="grid size-8 place-items-center rounded-md text-muted hover:bg-field hover:text-ink"
                >
                  <KeyRound className="size-4" strokeWidth={1.7} />
                </button>
                {u.id !== currentUserId && (
                  <form action={removeClientUser}>
                    <input type="hidden" name="organizationId" value={orgId} />
                    <input type="hidden" name="userId" value={u.id} />
                    <button
                      type="submit"
                      title="Eliminar usuario"
                      className="grid size-8 place-items-center rounded-md text-muted hover:bg-accent-red/10 hover:text-accent-red"
                    >
                      <Trash2 className="size-4" strokeWidth={1.7} />
                    </button>
                  </form>
                )}
              </div>

              {resetting === u.id && (
                <form action={resetClientPassword} className="mt-3 rounded-lg bg-field p-3.5">
                  <input type="hidden" name="organizationId" value={orgId} />
                  <input type="hidden" name="userId" value={u.id} />
                  <PasswordField
                    label="Nueva contraseña"
                    autoComplete="new-password"
                    withGenerator
                    minLength={10}
                    hint="La contraseña anterior no se puede ver: está guardada cifrada. Genera una nueva y pásasela."
                  />
                  <button
                    type="submit"
                    className="mt-3 inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover"
                  >
                    Guardar contraseña
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className={cn("border-t border-line px-5 py-4", users.length === 0 && "border-t-0 pt-0")}>
        {adding ? (
          <form action={addClientUser} className="flex flex-col gap-3">
            <input type="hidden" name="organizationId" value={orgId} />
            <div>
              <label className="block text-[13px] font-medium text-ink" htmlFor="new-user-email">
                Email
              </label>
              <input
                id="new-user-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[14px] text-ink focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-ink" htmlFor="new-user-role">
                Rol
              </label>
              <select
                id="new-user-role"
                name="role"
                defaultValue="agent"
                className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[14px] text-ink focus:border-primary focus:outline-none"
              >
                <option value="agent">Agente</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <PasswordField label="Contraseña" autoComplete="new-password" withGenerator minLength={10} />
            <div className="flex gap-2">
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover"
              >
                Crear usuario
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="inline-flex h-9 items-center rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field"
              >
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-primary hover:underline"
          >
            <Plus className="size-4" strokeWidth={2} />
            Agregar usuario
          </button>
        )}
      </div>
    </div>
  );
}
