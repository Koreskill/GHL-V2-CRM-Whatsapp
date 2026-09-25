"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import type { LeadTemperature, OperationType, ProspectUrgency } from "@/db/schema";
import { OPERATION_LABEL, URGENCY_LABEL, TEMPERATURE_META, type ContactTagSummary } from "@/lib/crm/tag-labels";
import { cn } from "@/lib/utils";

/**
 * Etiquetas del contacto: temperatura, operación, urgencia y presupuesto.
 *
 * La misma fila de chips se usa en tres lugares (conversación, Contactos, Pipeline) para que la
 * misma persona se vea igual en cualquier pantalla. Solo la conversación la muestra editable: ahí
 * es donde un asesor está mirando el hilo y puede corregir lo que el bot interpretó mal.
 */

function budget(summary: ContactTagSummary) {
  const fmt = (n: number) => `${summary.currency} ${n.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`;
  if (summary.priceMin !== null && summary.priceMax !== null) return `${fmt(summary.priceMin)} – ${fmt(summary.priceMax)}`;
  if (summary.priceMax !== null) return `hasta ${fmt(summary.priceMax)}`;
  if (summary.priceMin !== null) return `desde ${fmt(summary.priceMin)}`;
  return null;
}

export function ContactTagsBar({
  summary,
  onEdit,
  compact = false,
}: {
  summary: ContactTagSummary | null;
  onEdit?: () => void;
  compact?: boolean;
}) {
  if (!summary) return null;
  const temp = summary.temperature ? TEMPERATURE_META[summary.temperature] : null;
  const budgetText = budget(summary);
  const hasAny = summary.temperature || summary.operation || summary.urgency || budgetText;

  if (!hasAny && !onEdit) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "" : "min-w-0")}>
      {temp && (
        <span className={cn("inline-flex items-center gap-1 rounded-full bg-field px-2 py-0.5 text-[11px] font-medium", temp.text)}>
          <span className={cn("size-1.5 rounded-full", temp.dot)} />
          {temp.label}
        </span>
      )}
      {summary.operation && (
        <span className="inline-flex items-center rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-ink">
          {OPERATION_LABEL[summary.operation]}
        </span>
      )}
      {summary.urgency && (
        <span className="inline-flex items-center rounded-full bg-field px-2 py-0.5 text-[11px] font-medium text-muted">
          {URGENCY_LABEL[summary.urgency]}
        </span>
      )}
      {budgetText && (
        <span className="inline-flex items-center rounded-full bg-field px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted">
          {budgetText}
        </span>
      )}
      {!hasAny && <span className="text-[11px] text-muted">Sin etiquetas todavía</span>}
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          title="Editar etiquetas"
          aria-label="Editar etiquetas"
          className="grid size-5 shrink-0 place-items-center rounded-full text-muted hover:bg-field hover:text-ink"
        >
          <Pencil className="size-3" strokeWidth={1.8} />
        </button>
      )}
    </div>
  );
}

const TEMPERATURES: LeadTemperature[] = ["frio", "tibio", "caliente"];
const OPERATIONS: OperationType[] = ["venta", "alquiler", "temporario"];
const URGENCIES: ProspectUrgency[] = ["explorando", "meses", "ya"];

/** Panel de edición manual, para que un asesor corrija lo que el bot interpretó mal. */
export function ContactTagsEditPanel({
  summary,
  onSave,
  onClose,
}: {
  summary: ContactTagSummary;
  onSave: (next: ContactTagSummary) => void;
  onClose: () => void;
}) {
  const [temperature, setTemperature] = useState<LeadTemperature | "">(summary.temperature ?? "");
  const [operation, setOperation] = useState<OperationType | "">(summary.operation ?? "");
  const [urgency, setUrgency] = useState<ProspectUrgency | "">(summary.urgency ?? "");
  const [priceMin, setPriceMin] = useState(summary.priceMin?.toString() ?? "");
  const [priceMax, setPriceMax] = useState(summary.priceMax?.toString() ?? "");
  const [currency, setCurrency] = useState(summary.currency);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    const body = {
      temperature: temperature || null,
      operation: operation || null,
      urgency: urgency || null,
      priceMin: priceMin.trim() ? Number(priceMin) : null,
      priceMax: priceMax.trim() ? Number(priceMax) : null,
      currency: currency.trim().toUpperCase() || "USD",
    };
    const res = await fetch(`/api/contacts/${summary.contactId}/tags`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setSaving(false);
    if (!res?.ok) {
      setError(data?.error ?? "No se pudo guardar");
      return;
    }
    onSave(data as ContactTagSummary);
    onClose();
  }

  return (
    <div className="border-b border-line bg-card px-6 py-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-[12.5px] font-semibold text-ink">Editar etiquetas del contacto</p>
        <button onClick={onClose} aria-label="Cerrar" className="grid size-6 place-items-center rounded-md text-muted hover:bg-field hover:text-ink">
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Temperatura">
          <Select value={temperature} onChange={setTemperature}>
            <option value="">Sin clasificar</option>
            {TEMPERATURES.map((t) => (
              <option key={t} value={t}>
                {TEMPERATURE_META[t].label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Operación">
          <Select value={operation} onChange={setOperation}>
            <option value="">Sin dato</option>
            {OPERATIONS.map((o) => (
              <option key={o} value={o}>
                {OPERATION_LABEL[o]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Urgencia">
          <Select value={urgency} onChange={setUrgency}>
            <option value="">Sin dato</option>
            {URGENCIES.map((u) => (
              <option key={u} value={u}>
                {URGENCY_LABEL[u]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Presupuesto desde">
          <input
            type="number"
            min={0}
            value={priceMin}
            onChange={(e) => setPriceMin(e.target.value)}
            className="h-8 w-24 rounded-lg border border-line bg-field px-2 text-[12.5px] text-ink focus:outline-none"
          />
        </Field>
        <Field label="Hasta">
          <input
            type="number"
            min={0}
            value={priceMax}
            onChange={(e) => setPriceMax(e.target.value)}
            className="h-8 w-24 rounded-lg border border-line bg-field px-2 text-[12.5px] text-ink focus:outline-none"
          />
        </Field>
        <Field label="Moneda">
          <input
            type="text"
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            className="h-8 w-16 rounded-lg border border-line bg-field px-2 text-[12.5px] text-ink uppercase focus:outline-none"
          />
        </Field>

        <button
          onClick={save}
          disabled={saving}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-medium text-white disabled:opacity-60"
        >
          <Check className="size-3.5" strokeWidth={2} />
          {saving ? "Guardando…" : "Guardar"}
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-accent-red">{error}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
    </label>
  );
}

function Select<T extends string>({ value, onChange, children }: { value: T | ""; onChange: (v: T | "") => void; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T | "")}
      className="h-8 rounded-lg border border-line bg-field px-2 text-[12.5px] text-ink focus:outline-none"
    >
      {children}
    </select>
  );
}
