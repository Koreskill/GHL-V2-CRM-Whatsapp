"use client";

import { useState } from "react";
import type { ProfileRow } from "@/lib/scoring/store";
import { cn } from "@/lib/utils";

const TYPES = ["departamento", "casa", "ph", "terreno", "local", "oficina", "cochera"];
const field = "h-8 w-full rounded-lg border border-line bg-field px-2 text-[12.5px] text-ink focus:border-primary focus:outline-none";

const get = <T,>(rows: ProfileRow[], key: string): T | undefined => rows.find((r) => r.key === key)?.value as T | undefined;
const strictOf = (rows: ProfileRow[], key: string) => rows.find((r) => r.key === key)?.strict === true;
const join = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Corrección manual de lo que busca el contacto. Lo que se guarda queda marcado como "manual" y la
 * extracción automática no lo vuelve a pisar. Solo se envía lo que cambió.
 */
export function PreferencesEditor({
  conversationId,
  profile,
  currency,
  onSaved,
}: {
  conversationId: string;
  profile: ProfileRow[];
  currency: string | null;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    operation: (get<string>(profile, "operation") ?? "") as string,
    propertyTypes: (get<string[]>(profile, "propertyTypes") ?? []) as string[],
    zones: join(get(profile, "zones")),
    budgetMin: String(get<number>(profile, "budgetMin") ?? ""),
    budgetMax: String(get<number>(profile, "budgetMax") ?? ""),
    currency: currency ?? "",
    budgetFlexible: get<boolean>(profile, "budgetFlexible") === true,
    bedroomsMin: String(get<number>(profile, "bedroomsMin") ?? ""),
    bathroomsMin: String(get<number>(profile, "bathroomsMin") ?? ""),
    surfaceMin: String(get<number>(profile, "surfaceMin") ?? ""),
    requiredAmenities: join(get(profile, "requiredAmenities")),
    preferredAmenities: join(get(profile, "preferredAmenities")),
    excludedFeatures: join(get(profile, "excludedFeatures")),
    sPresupuesto: strictOf(profile, "budgetMax"),
    sZona: strictOf(profile, "zones"),
    sDormitorios: strictOf(profile, "bedroomsMin"),
    sTipo: strictOf(profile, "propertyTypes"),
  }));
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    setError(null);
    const fields = {
      operation: form.operation || null,
      propertyTypes: form.propertyTypes,
      zones: split(form.zones),
      budgetMin: form.budgetMin === "" ? null : form.budgetMin,
      budgetMax: form.budgetMax === "" ? null : form.budgetMax,
      bedroomsMin: form.bedroomsMin === "" ? null : form.bedroomsMin,
      bathroomsMin: form.bathroomsMin === "" ? null : form.bathroomsMin,
      surfaceMin: form.surfaceMin === "" ? null : form.surfaceMin,
      requiredAmenities: split(form.requiredAmenities),
      preferredAmenities: split(form.preferredAmenities),
      excludedFeatures: split(form.excludedFeatures),
      budgetFlexible: form.budgetFlexible,
      ...(form.currency ? { currency: form.currency } : {}),
    };
    const strict = { budgetMax: form.sPresupuesto, zones: form.sZona, bedroomsMin: form.sDormitorios, propertyTypes: form.sTipo };
    const res = await fetch(`/api/conversations/${conversationId}/preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields, strict }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = res ? await res.json().catch(() => null) : null;
      return setError(data?.error ?? "No se pudo guardar.");
    }
    onSaved();
  }

  const label = "flex flex-col gap-1 text-[11px] text-muted";
  return (
    <div className="grid gap-2.5 border-b border-line bg-field/40 px-4 py-3">
      <p className="text-[11.5px] leading-snug text-muted">Lo que corrijas acá manda sobre lo que detecta el agente y recalcula las compatibilidades.</p>
      <label className={label}>
        Operación
        <select value={form.operation} onChange={(e) => set("operation", e.target.value)} className={field}>
          <option value="">Sin definir</option>
          <option value="venta">Venta</option>
          <option value="alquiler">Alquiler</option>
          <option value="temporario">Temporario</option>
        </select>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {TYPES.map((t) => {
          const on = form.propertyTypes.includes(t);
          return (
            <button
              key={t}
              type="button"
              onClick={() => set("propertyTypes", on ? form.propertyTypes.filter((x) => x !== t) : [...form.propertyTypes, t])}
              className={cn("h-7 rounded-full px-2.5 text-[11.5px] font-medium", on ? "bg-primary text-white" : "border border-line bg-card text-muted")}
            >
              {t}
            </button>
          );
        })}
      </div>
      <label className={label}>
        Zonas (separadas por coma)
        <input value={form.zones} onChange={(e) => set("zones", e.target.value)} className={field} />
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className={label}>
          Mínimo
          <input value={form.budgetMin} onChange={(e) => set("budgetMin", e.target.value)} inputMode="numeric" className={field} />
        </label>
        <label className={label}>
          Máximo
          <input value={form.budgetMax} onChange={(e) => set("budgetMax", e.target.value)} inputMode="numeric" className={field} />
        </label>
        <label className={label}>
          Moneda
          <select value={form.currency} onChange={(e) => set("currency", e.target.value)} className={field}>
            <option value="">—</option>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 text-[12px] text-ink">
        <input type="checkbox" checked={form.budgetFlexible} onChange={(e) => set("budgetFlexible", e.target.checked)} className="size-3.5 accent-[var(--color-primary)]" />
        El presupuesto es flexible (hasta ~15% más)
      </label>
      <div className="grid grid-cols-3 gap-2">
        <label className={label}>
          Dormitorios
          <input value={form.bedroomsMin} onChange={(e) => set("bedroomsMin", e.target.value)} inputMode="numeric" className={field} />
        </label>
        <label className={label}>
          Baños
          <input value={form.bathroomsMin} onChange={(e) => set("bathroomsMin", e.target.value)} inputMode="numeric" className={field} />
        </label>
        <label className={label}>
          m² mín.
          <input value={form.surfaceMin} onChange={(e) => set("surfaceMin", e.target.value)} inputMode="numeric" className={field} />
        </label>
      </div>
      <label className={label}>
        Necesita (indispensable)
        <input value={form.requiredAmenities} onChange={(e) => set("requiredAmenities", e.target.value)} placeholder="pileta, cochera" className={field} />
      </label>
      <label className={label}>
        Le gustaría
        <input value={form.preferredAmenities} onChange={(e) => set("preferredAmenities", e.target.value)} placeholder="jardín, quincho" className={field} />
      </label>
      <label className={label}>
        No quiere
        <input value={form.excludedFeatures} onChange={(e) => set("excludedFeatures", e.target.value)} placeholder="escaleras" className={field} />
      </label>
      <fieldset className="grid grid-cols-2 gap-1">
        <legend className="mb-1 text-[11px] text-muted">Es indispensable:</legend>
        {(
          [
            ["sPresupuesto", "El presupuesto máximo"],
            ["sZona", "La zona"],
            ["sDormitorios", "Los dormitorios"],
            ["sTipo", "El tipo"],
          ] as const
        ).map(([k, text]) => (
          <label key={k} className="flex items-center gap-1.5 text-[11.5px] text-ink">
            <input type="checkbox" checked={form[k]} onChange={(e) => set(k, e.target.checked)} className="size-3.5 accent-[var(--color-primary)]" />
            {text}
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className="text-[12px] text-accent-red">{error}</p>}
      <button type="button" onClick={save} disabled={saving} className="h-8 rounded-lg bg-primary text-[12.5px] font-medium text-white hover:bg-primary-hover disabled:opacity-60">
        {saving ? "Guardando…" : "Guardar y recalcular"}
      </button>
    </div>
  );
}
