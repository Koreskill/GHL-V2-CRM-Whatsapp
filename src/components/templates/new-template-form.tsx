"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { AlertCircle, Loader2 } from "lucide-react";
import { createTemplateAction } from "@/app/(app)/plantillas/actions";
import { Button, Card } from "@/components/ui/primitives";

const field = "h-10 w-full rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";
const labelClass = "mb-1.5 block text-[13px] font-medium text-ink";

export function NewTemplateForm({ accounts }: { accounts: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createTemplateAction, { error: null });
  const [body, setBody] = useState("");
  const [headerFormat, setHeaderFormat] = useState("none");
  const [headerText, setHeaderText] = useState("");
  const [footer, setFooter] = useState("");
  const [buttons, setButtons] = useState<{ type: string; text: string; url: string; phone: string }[]>([]);
  const headerHasVar = /\{\{\s*1\s*\}\}/.test(headerText);
  const vars = [...new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => Number(m.replace(/\D/g, ""))))].sort((a, b) => a - b);

  return (
    <form action={action}>
      <Card className="grid gap-6 p-6 md:grid-cols-2">
        {accounts.length > 1 ? (
          <div>
            <label className={labelClass} htmlFor="accountId">Cuenta</label>
            <select id="accountId" name="accountId" className={field}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="accountId" value={accounts[0].id} />
        )}

        <div>
          <label className={labelClass} htmlFor="name">Nombre</label>
          <input id="name" name="name" required maxLength={512} pattern="[a-z][a-z0-9_]*" placeholder="seguimiento_visita" className={field} />
          <p className="mt-1 text-[12px] text-muted">Minúsculas, números y guion bajo.</p>
        </div>

        <div>
          <label className={labelClass} htmlFor="category">Categoría</label>
          <select id="category" name="category" className={field} defaultValue="UTILITY">
            <option value="UTILITY">Utilidad (seguimientos, confirmaciones)</option>
            <option value="MARKETING">Marketing (promociones)</option>
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="language">Idioma</label>
          <select id="language" name="language" className={field} defaultValue="es_AR">
            <option value="es_AR">Español (Argentina)</option>
            <option value="es">Español</option>
            <option value="es_MX">Español (México)</option>
            <option value="es_ES">Español (España)</option>
            <option value="en_US">Inglés (EE. UU.)</option>
            <option value="pt_BR">Portugués (Brasil)</option>
          </select>
        </div>

        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="body">Mensaje</label>
          <textarea
            id="body"
            name="body"
            required
            maxLength={1024}
            rows={5}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Hola {{1}}, te escribimos por la propiedad que consultaste. ¿Seguís interesado?"
            className="w-full rounded-xl border border-line bg-field px-4 py-3 text-[13.5px] leading-relaxed text-ink focus:border-primary focus:outline-none"
          />
          <p className="mt-1 text-[12px] text-muted">Usa {"{{1}}"}, {"{{2}}"}… para las partes que cambian en cada envío.</p>
        </div>

        <div className="grid gap-4 md:col-span-2 sm:grid-cols-[180px_1fr]">
          <div>
            <label className={labelClass} htmlFor="headerFormat">Encabezado</label>
            <select
              id="headerFormat"
              name="headerFormat"
              value={headerFormat}
              onChange={(e) => setHeaderFormat(e.target.value)}
              className={field}
            >
              <option value="none">Sin encabezado</option>
              <option value="text">Texto</option>
              <option value="image">Imagen</option>
              <option value="video">Video</option>
              <option value="document">Documento</option>
            </select>
          </div>

          {headerFormat === "text" && (
            <div>
              <label className={labelClass} htmlFor="headerText">Texto del encabezado</label>
              <input
                id="headerText"
                name="headerText"
                maxLength={60}
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder="Novedades de {{1}}"
                className={field}
              />
              <p className="mt-1 text-[12px] text-muted">
                Hasta 60 caracteres y una sola variable, {"{{1}}"}. No comparte numeración con el mensaje.
              </p>
            </div>
          )}

          {headerFormat !== "none" && headerFormat !== "text" && (
            <div>
              <label className={labelClass} htmlFor="headerExample">Archivo de muestra</label>
              <input id="headerExample" name="headerExample" type="url" placeholder="https://…" className={field} />
              <p className="mt-1 text-[12px] text-muted">
                Enlace https al archivo que Meta va a mirar para aprobar la plantilla.
              </p>
            </div>
          )}

          {headerFormat === "text" && headerHasVar && (
            <div className="sm:col-start-2">
              <label className={labelClass} htmlFor="headerExample">Ejemplo del encabezado</label>
              <input id="headerExample" name="headerExample" maxLength={200} placeholder="Palermo" className={field} />
            </div>
          )}
        </div>

        <div className="md:col-span-2">
          <label className={labelClass} htmlFor="footer">Pie</label>
          <input
            id="footer"
            name="footer"
            maxLength={60}
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
            placeholder="Respondé BAJA para no recibir más mensajes"
            className={field}
          />
          <p className="mt-1 text-[12px] text-muted">Opcional, hasta 60 caracteres. No admite variables.</p>
        </div>

        <div className="md:col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-ink">Botones</span>
            {buttons.length < 3 && (
              <button
                type="button"
                onClick={() => setButtons((b) => [...b, { type: "quick_reply", text: "", url: "", phone: "" }])}
                className="text-[13px] font-medium text-primary hover:underline"
              >
                Agregar botón
              </button>
            )}
          </div>

          {buttons.length === 0 ? (
            <p className="text-[12px] text-muted">
              Opcional: respuesta rápida, enlace o teléfono. WhatsApp admite un solo botón de teléfono y hasta dos
              de enlace.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {buttons.map((b, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-field p-3">
                  <select
                    name={"buttonType_" + i}
                    value={b.type}
                    aria-label={"Tipo del botón " + (i + 1)}
                    onChange={(e) =>
                      setButtons((prev) => prev.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))
                    }
                    className="h-9 w-40 rounded-lg border border-line bg-card px-2 text-[13px] text-ink focus:border-primary focus:outline-none"
                  >
                    <option value="quick_reply">Respuesta rápida</option>
                    <option value="url">Enlace</option>
                    <option value="phone_number">Teléfono</option>
                  </select>
                  <input
                    name={"buttonText_" + i}
                    value={b.text}
                    maxLength={25}
                    aria-label={"Etiqueta del botón " + (i + 1)}
                    onChange={(e) =>
                      setButtons((prev) => prev.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))
                    }
                    placeholder="Etiqueta"
                    className="h-9 w-40 rounded-lg border border-line bg-card px-2 text-[13px] text-ink focus:border-primary focus:outline-none"
                  />
                  {b.type === "url" && (
                    <input
                      name={"buttonUrl_" + i}
                      type="url"
                      value={b.url}
                      aria-label={"Enlace del botón " + (i + 1)}
                      onChange={(e) =>
                        setButtons((prev) => prev.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))
                      }
                      placeholder="https://…"
                      className="h-9 min-w-48 flex-1 rounded-lg border border-line bg-card px-2 text-[13px] text-ink focus:border-primary focus:outline-none"
                    />
                  )}
                  {b.type === "phone_number" && (
                    <input
                      name={"buttonPhone_" + i}
                      value={b.phone}
                      aria-label={"Teléfono del botón " + (i + 1)}
                      onChange={(e) =>
                        setButtons((prev) => prev.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))
                      }
                      placeholder="+5491100000000"
                      className="h-9 min-w-48 flex-1 rounded-lg border border-line bg-card px-2 text-[13px] text-ink focus:border-primary focus:outline-none"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setButtons((prev) => prev.filter((_, j) => j !== i))}
                    className="h-9 rounded-lg border border-line bg-card px-2.5 text-[13px] text-muted hover:text-ink"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Vista previa: cómo lo va a ver la persona en WhatsApp. */}
        <div className="md:col-span-2">
          <span className="mb-1.5 block text-[13px] font-medium text-ink">Vista previa</span>
          <div className="rounded-xl bg-field p-4">
            <div className="max-w-sm rounded-2xl rounded-bl-md border border-line bg-card px-3.5 py-2.5">
              {headerFormat === "text" && headerText && (
                <p className="mb-1 text-[13.5px] font-semibold text-ink">{headerText}</p>
              )}
              {headerFormat !== "none" && headerFormat !== "text" && (
                <p className="mb-1.5 grid h-20 place-items-center rounded-lg bg-field text-[12px] text-muted">
                  {headerFormat === "image" ? "Imagen" : headerFormat === "video" ? "Video" : "Documento"}
                </p>
              )}
              <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink">
                {body || <span className="text-muted">El mensaje aparece acá.</span>}
              </p>
              {footer && <p className="mt-1.5 text-[11.5px] text-muted">{footer}</p>}
            </div>
            {buttons.filter((b) => b.text).length > 0 && (
              <div className="mt-1.5 flex max-w-sm flex-col gap-1">
                {buttons
                  .filter((b) => b.text)
                  .map((b, i) => (
                    <span
                      key={i}
                      className="rounded-lg border border-line bg-card px-3 py-1.5 text-center text-[13px] font-medium text-primary"
                    >
                      {b.text}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </div>

        {vars.length > 0 && (
          <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
            {vars.map((v) => (
              <div key={v}>
                <label className={labelClass} htmlFor={`example_${v}`}>Ejemplo para {`{{${v}}}`}</label>
                <input id={`example_${v}`} name={`example_${v}`} required maxLength={200} placeholder="Juan" className={field} />
              </div>
            ))}
          </div>
        )}

        {state.error && (
          <p className="flex items-start gap-2 rounded-lg bg-accent-red/10 px-3 py-2 text-[13px] text-ink md:col-span-2">
            <AlertCircle className="mt-px size-4 shrink-0 text-accent-red" /> {state.error}
          </p>
        )}

        <div className="flex justify-end gap-2.5 md:col-span-2">
          <Link href="/plantillas" className="inline-flex h-9 items-center rounded-lg border border-line bg-card px-3.5 text-[13.5px] font-medium text-ink hover:bg-field">
            Cancelar
          </Link>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />} Enviar a revisión
          </Button>
        </div>
      </Card>
    </form>
  );
}
