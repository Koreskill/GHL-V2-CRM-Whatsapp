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
