"use client";

import { useActionState } from "react";
import { AlertTriangle, CheckCircle2, ListChecks, Loader2, ScanSearch } from "lucide-react";
import { FIELD_INFO, exampleNames, type Field } from "@/lib/sheets/columns";
import type { AnalyzeState } from "@/lib/sheets/analyze-run";
import { cn } from "@/lib/utils";

const LEVEL: Record<string, { label: string; tone: string }> = {
  obligatoria: { label: "Obligatoria", tone: "bg-accent-red/10 text-accent-red" },
  recomendada: { label: "Recomendada", tone: "bg-accent-amber/12 text-accent-amber" },
  opcional: { label: "Opcional", tone: "bg-field text-muted" },
};

/**
 * Revisa la hoja SIN importar nada y muestra qué se entendió de cada columna (en español o en
 * inglés), qué columnas no se usan, qué falta y cuántas filas se pueden cargar.
 */
export function SheetCheck({ action, orgId }: { action: (prev: AnalyzeState, formData: FormData) => Promise<Exclude<AnalyzeState, null>>; orgId?: string }) {
  const [state, run, pending] = useActionState<AnalyzeState, FormData>(action, null);

  return (
    <div className="mt-4 border-t border-line pt-4">
      <form action={run} className="flex flex-wrap items-center gap-3">
        {orgId && <input type="hidden" name="organizationId" value={orgId} />}
        <button type="submit" disabled={pending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field disabled:opacity-60">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" strokeWidth={1.7} />}
          Revisar columnas de la hoja
        </button>
        <span className="text-[12px] text-muted">No importa nada: solo muestra qué se entiende.</span>
      </form>

      {state && !state.ok && <p className="mt-3 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-accent-red">{state.error}</p>}

      {state?.ok && (
        <div className="mt-4 grid gap-4 text-[13px]">
          {(() => {
            const a = state.analysis;
            const c = a.counts;
            return (
              <>
                <p className="flex items-start gap-2 text-ink">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent-green" strokeWidth={1.8} />
                  <span>
                    Se pueden cargar <strong>{c.importable}</strong> de {a.rows} filas.
                    {c.sinIdentificador > 0 && <> {c.sinIdentificador} sin identificador.</>}
                    {c.identificadorRepetido > 0 && <> {c.identificadorRepetido} con identificador repetido.</>}
                    {c.ambasOperaciones > 0 && <> {c.ambasOperaciones} ofrecen venta y alquiler a la vez (elegí una).</>}
                    {c.operacionNoReconocida > 0 && <> {c.operacionNoReconocida} con la operación sin entender.</>}
                  </span>
                </p>

                {(c.sinPrecio > 0 || c.sinPortada > 0 || c.sinZona > 0) && (
                  <p className="flex items-start gap-2 text-ink">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-amber" strokeWidth={1.8} />
                    <span>
                      Se cargan, pero con datos incompletos:
                      {c.sinPrecio > 0 && <> {c.sinPrecio} sin precio</>}
                      {c.sinPortada > 0 && <>{c.sinPrecio > 0 ? "," : ""} {c.sinPortada} sin portada</>}
                      {c.sinZona > 0 && <>{c.sinPrecio + c.sinPortada > 0 ? "," : ""} {c.sinZona} sin zona</>}.
                    </span>
                  </p>
                )}

                {a.missing.length > 0 && (
                  <div>
                    <p className="font-medium text-ink">Columnas que la hoja no tiene</p>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {a.missing.map((m) => (
                        <li key={m.field} className="flex flex-wrap items-baseline gap-2">
                          <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", LEVEL[m.level].tone)}>{LEVEL[m.level].label}</span>
                          <span className="text-ink">{m.label}</span>
                          <span className="text-muted">
                            — por ejemplo <code className="rounded bg-field px-1 text-[12px]">{exampleNames(m.field).en}</code> o <code className="rounded bg-field px-1 text-[12px]">{exampleNames(m.field).es}</code>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {a.unknownValues.length > 0 && (
                  <div>
                    <p className="font-medium text-ink">Valores que no se reconocen</p>
                    <ul className="mt-1.5 list-inside list-disc text-muted">
                      {a.unknownValues.map((u) => (
                        <li key={`${u.column}${u.value}`}>
                          {u.column}: «{u.value}» ({u.count} fila{u.count === 1 ? "" : "s"})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <details>
                  <summary className="cursor-pointer font-medium text-ink">
                    Columnas que se entendieron ({a.mapped.length}) {a.unused.length > 0 && <span className="font-normal text-muted">· {a.unused.length} sin usar</span>}
                  </summary>
                  <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    {a.mapped.map((m) => (
                      <li key={m.header} className="flex items-baseline gap-1.5">
                        <code className="rounded bg-field px-1 text-[12px] text-ink">{m.header}</code>
                        <span className="text-muted">→ {m.label}</span>
                        {m.how === "aproximado" && <span className="text-[11px] text-accent-amber">(aproximado)</span>}
                      </li>
                    ))}
                  </ul>
                  {a.unused.length > 0 && (
                    <p className="mt-2 text-muted">
                      Sin usar (no se reconocen): {a.unused.map((u) => <code key={u} className="mr-1 rounded bg-field px-1 text-[12px]">{u}</code>)}
                    </p>
                  )}
                </details>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const ORDER: Field[] = ["externalId", "operation", "propertyType", "title", "priceSale", "priceRent", "zone", "city", "coverUrl", "sourceUrl", "status", "bedrooms", "bathrooms", "parking", "areaM2"];

/** Lo que conviene seguir al armar la hoja. Va debajo de donde se carga. */
export function SheetRequirements({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return (
    <details className="mt-4 border-t border-line pt-4 text-[13px]" open={defaultOpen}>
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-ink">
        <ListChecks className="size-4 text-muted" strokeWidth={1.7} /> Requisitos recomendados para la hoja
        <span className="text-[12px] font-normal text-muted">· tocá para ver o ocultar</span>
      </summary>

      <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-muted marker:text-line">
        <li>Una fila por propiedad, con los nombres de las columnas en la <strong className="text-ink">primera fila</strong> de la pestaña conectada.</li>
        <li>
          <strong className="text-ink">Un identificador único y estable por propiedad</strong> (<code className="rounded bg-field px-1 text-[12px]">property_id</code> o <code className="rounded bg-field px-1 text-[12px]">id</code>). No lo repitas ni lo cambies: si cambia, se toma como otra propiedad y la anterior se pausa.
        </li>
        <li>La <strong className="text-ink">operación</strong> de cada fila: venta, alquiler o temporario (en inglés: sale, rent). Una sola por fila; si ofrece las dos, usá dos filas con identificadores distintos.</li>
        <li>
          Los <strong className="text-ink">precios como número</strong> (<code className="rounded bg-field px-1 text-[12px]">120000</code> o <code className="rounded bg-field px-1 text-[12px]">120.000</code>), sin texto adentro, con su moneda (USD o ARS) en la columna de al lado. Una venta usa el precio de venta y un alquiler el de alquiler.
        </li>
        <li>Barrio y localidad completos: con eso el agente busca y compara propiedades.</li>
        <li>Superficies, dormitorios, baños y cocheras como números.</li>
        <li>La portada y el enlace del aviso como <strong className="text-ink">enlaces https</strong>. Una imagen pegada dentro de la celda no sirve.</li>
        <li>Estado: disponible, reservada, vendida, alquilada o pausada. Vacío se toma como disponible.</li>
        <li>Si sacás una propiedad de la hoja, en el CRM queda <strong className="text-ink">pausada</strong> (no se borra: conserva su historial).</li>
        <li>La hoja tiene que ser pública o estar compartida con la cuenta de servicio de la plataforma.</li>
        <li>El CRM <strong className="text-ink">no completa datos por su cuenta</strong>: lo que falta o viene mal queda señalado en la ficha de cada propiedad.</li>
      </ul>

      <p className="mt-4 mb-1.5 font-medium text-ink">Nombres de columna que se entienden</p>
      <p className="mb-2 text-[12px] text-muted">En español o en inglés, con o sin tildes, con espacios o guion bajo. Estos son algunos ejemplos:</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[11px] font-semibold tracking-wide text-muted uppercase">
              <th className="py-1.5 pr-3 font-semibold">Dato</th>
              <th className="py-1.5 pr-3 font-semibold">Necesidad</th>
              <th className="py-1.5 pr-3 font-semibold">Inglés</th>
              <th className="py-1.5 pr-3 font-semibold">Español</th>
            </tr>
          </thead>
          <tbody>
            {ORDER.map((f) => {
              const info = FIELD_INFO[f]!;
              const ex = exampleNames(f);
              return (
                <tr key={f} className="border-b border-line/60 align-top last:border-0">
                  <td className="py-1.5 pr-3 text-ink">
                    {info.label}
                    <span className="block text-[11.5px] text-muted">{info.hint}</span>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", LEVEL[info.level].tone)}>{LEVEL[info.level].label}</span>
                  </td>
                  <td className="py-1.5 pr-3"><code className="rounded bg-field px-1 text-[12px]">{ex.en}</code></td>
                  <td className="py-1.5 pr-3"><code className="rounded bg-field px-1 text-[12px]">{ex.es}</code></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
