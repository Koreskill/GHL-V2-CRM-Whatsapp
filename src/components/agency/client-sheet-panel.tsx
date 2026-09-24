"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CheckCircle2, Home, RefreshCw } from "lucide-react";
import { saveSheetConfig, syncClientProperties } from "@/app/(app)/agencia/actions";
import { Card } from "@/components/ui/primitives";
import { formatListDate } from "@/lib/format";

type Sheet = {
  spreadsheetId: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  lastRowsUpserted: number | null;
  lastRowsSkipped: number | null;
};

function SyncButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field disabled:opacity-60"
    >
      <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} strokeWidth={1.7} />
      {pending ? "Sincronizando…" : "Sincronizar ahora"}
    </button>
  );
}

/**
 * La hoja de Google de un cliente: conectarla y sincronizar a mano.
 * La hoja es la fuente de la cartera; el CRM la refleja. Por eso no hay edición de propiedades
 * desde acá: si se editara en los dos lados, los precios quedarían distintos.
 */
export function ClientSheetPanel({
  orgId,
  sheet,
  catalog,
}: {
  orgId: string;
  sheet: Sheet | null;
  catalog: { total: number; disponibles: number; conAvisos: number };
}) {
  const [editing, setEditing] = useState(!sheet);

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line px-5 py-4">
        <Home className="size-4 text-muted" strokeWidth={1.7} />
        <h2 className="text-[15px] font-semibold text-ink">Cartera de propiedades</h2>
        {sheet && (
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="ml-auto text-[13px] font-medium text-primary hover:underline"
          >
            {editing ? "Cancelar" : "Cambiar hoja"}
          </button>
        )}
      </div>

      <div className="px-5 py-4">
        <p className="text-[13px] text-ink">
          {catalog.total} propiedad{catalog.total === 1 ? "" : "es"} · {catalog.disponibles} disponible
          {catalog.disponibles === 1 ? "" : "s"}
          {catalog.conAvisos > 0 && (
            <span className="text-accent-amber"> · {catalog.conAvisos} con datos incompletos</span>
          )}
        </p>

        {sheet && !editing && (
          <>
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted">
              {sheet.lastStatus === "error" ? (
                <>
                  <AlertTriangle className="size-3.5 shrink-0 text-accent-red" strokeWidth={1.8} />
                  <span className="text-accent-red">{sheet.lastError}</span>
                </>
              ) : sheet.lastRunAt ? (
                <>
                  <CheckCircle2 className="size-3.5 shrink-0 text-accent-green" strokeWidth={1.8} />
                  Última sincronización {formatListDate(sheet.lastRunAt)} · {sheet.lastRowsUpserted ?? 0}{" "}
                  actualizadas
                  {(sheet.lastRowsSkipped ?? 0) > 0 && ` · ${sheet.lastRowsSkipped} omitidas`}
                </>
              ) : (
                "Hoja conectada, todavía sin sincronizar."
              )}
            </p>

            <form action={syncClientProperties} className="mt-3">
              <input type="hidden" name="organizationId" value={orgId} />
              <SyncButton />
            </form>
          </>
        )}

        {editing && (
          <form action={saveSheetConfig} className="mt-3">
            <input type="hidden" name="organizationId" value={orgId} />
            <label className="block text-[13px] font-medium text-ink" htmlFor="spreadsheet">
              Hoja de Google
            </label>
            <input
              id="spreadsheet"
              name="spreadsheet"
              required
              defaultValue={sheet ? `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}` : ""}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none"
            />
            <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
              Pega la URL completa. La hoja necesita una columna <code>property_id</code>: es la que identifica
              cada propiedad y permite actualizarla aunque cambie el título o el precio.
            </p>
            <button
              type="submit"
              className="mt-3 inline-flex h-9 items-center rounded-lg bg-primary px-3.5 text-[13.5px] font-medium text-white hover:bg-primary-hover"
            >
              Guardar hoja
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}
