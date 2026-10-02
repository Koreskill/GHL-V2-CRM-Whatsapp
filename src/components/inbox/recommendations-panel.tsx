"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Lightbulb, Link2Off, SlidersHorizontal } from "lucide-react";
import { BAND_LABEL, type Band } from "@/lib/scoring/config";
import type { Recommendation, Recommendations } from "@/lib/scoring/store";
import { cn } from "@/lib/utils";
import { PreferencesEditor } from "./preferences-editor";

const POLL_MS = 10_000;
type Tab = "cartera" | "red";

const money = (s: Recommendation) => (s.price == null ? "Consultar" : `${s.currency} ${s.price.toLocaleString("es-AR", { maximumFractionDigits: 0 })}`);

// Solo describe la compatibilidad con ESTE contacto: nunca si la propiedad es "buena" o "mala".
const BAND_TONE: Record<Band, string> = {
  strong: "bg-accent-green/12 text-accent-green",
  possible: "bg-accent-amber/12 text-accent-amber",
  weak: "bg-accent-orange/12 text-accent-orange",
  low: "bg-field text-muted",
};

const LABEL: Record<string, string> = {
  operation: "Operación",
  propertyTypes: "Tipo",
  zones: "Zona",
  province: "Provincia",
  budgetMin: "Presup. mín.",
  budgetMax: "Presup. máx.",
  budgetFlexible: "Flexible",
  bedroomsMin: "Dormitorios",
  bathroomsMin: "Baños",
  surfaceMin: "m² mín.",
  requiredAmenities: "Necesita",
  preferredAmenities: "Le gustaría",
  excludedFeatures: "No quiere",
};

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : typeof v === "boolean" ? (v ? "sí" : "no") : typeof v === "number" ? v.toLocaleString("es-AR") : String(v));

/**
 * Propiedades recomendadas para el contacto de esta conversación, ordenadas por compatibilidad, con
 * por qué. Tocar una carga su enlace en la barra de mensaje: NO se envía nada. Se actualiza sola a
 * medida que el agente (o una persona) completa lo que busca.
 */
export function RecommendationsPanel({ conversationId, onPick }: { conversationId: string; onPick: (link: string) => void }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<Tab>("cartera");
  const [data, setData] = useState<Recommendations | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const load = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const res = await fetch(`/api/conversations/${conversationId}/recommendations`).catch(() => null);
    if (!res?.ok) return setFailed(true);
    setFailed(false);
    setData((await res.json().catch(() => null)) as Recommendations | null);
  }, [conversationId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const id = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  const list = data ? data[tab] : [];
  const total = data ? data.cartera.length + data.red.length : 0;

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title="Mostrar propiedades recomendadas" className="flex w-10 shrink-0 flex-col items-center gap-2 border-l border-line bg-card py-4 text-muted hover:text-ink">
        <Lightbulb className="size-4" strokeWidth={1.8} />
        {total > 0 && <span className="rounded-full bg-primary px-1.5 text-[10.5px] font-semibold text-white">{total}</span>}
        <span className="sr-only">Mostrar recomendaciones</span>
      </button>
    );
  }

  return (
    <aside aria-label="Propiedades recomendadas" className="flex w-[320px] shrink-0 flex-col border-l border-line bg-card">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3.5">
        <Lightbulb className="size-4 text-muted" strokeWidth={1.8} />
        <h2 className="flex-1 text-[14px] font-semibold text-ink">Propiedades recomendadas</h2>
        <button type="button" onClick={() => setEditing((v) => !v)} title="Corregir lo que busca" aria-pressed={editing} className={cn("grid size-7 place-items-center rounded-md hover:bg-field hover:text-ink", editing ? "bg-field text-ink" : "text-muted")}>
          <SlidersHorizontal className="size-4" strokeWidth={1.8} />
          <span className="sr-only">Corregir preferencias</span>
        </button>
        <button type="button" onClick={() => setOpen(false)} title="Ocultar" className="grid size-7 place-items-center rounded-md text-muted hover:bg-field hover:text-ink">
          <ChevronRight className="size-4" strokeWidth={1.8} />
          <span className="sr-only">Ocultar recomendaciones</span>
        </button>
      </div>

      {editing && data && (
        <PreferencesEditor
          key={data.profile.map((p) => `${p.key}${p.updatedAt}`).join("|")}
          conversationId={conversationId}
          profile={data.profile}
          currency={data.currency}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}

      {data && data.profile.length > 0 && !editing && (
        <div className="border-b border-line px-4 py-2.5">
          <button type="button" onClick={() => setShowProfile((v) => !v)} aria-expanded={showProfile} className="flex w-full items-center justify-between text-[11.5px] font-medium text-muted hover:text-ink">
            <span>Lo que busca · {Math.round(data.coverage * 100)}% conocido</span>
            <span>{showProfile ? "Ocultar" : "Ver"}</span>
          </button>
          {showProfile && (
            <ul className="mt-2 flex flex-col gap-1">
              {data.profile.map((p) => (
                <li key={p.key} className="flex items-baseline gap-1.5 text-[12px]">
                  <span className="text-muted">{LABEL[p.key] ?? p.key}:</span>
                  <span className="min-w-0 flex-1 truncate text-ink">{show(p.value)}</span>
                  {p.strict && <span className="rounded bg-accent-red/10 px-1 text-[10px] font-medium text-accent-red">indispensable</span>}
                  <span title={p.source === "manual" ? "Lo corrigió una persona" : `Detectado por el agente (${Math.round(p.confidence * 100)}% de confianza)`} className={cn("rounded px-1 text-[10px] font-medium", p.source === "manual" ? "bg-primary/10 text-primary" : "bg-field text-muted")}>
                    {p.source === "manual" ? "manual" : "IA"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div role="tablist" className="mx-4 mt-3 flex gap-1 rounded-xl bg-field p-0.5">
        {(["cartera", "red"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium", tab === t ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink")}>
            {t === "cartera" ? "Cartera" : "Red"}
            <span className="rounded-md bg-line/60 px-1 text-[11px] text-muted">{data ? data[t].length : 0}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {failed && !data ? (
          <p className="px-1 text-[12.5px] text-muted">No se pudieron cargar las recomendaciones.</p>
        ) : !data ? (
          <p className="px-1 text-[12.5px] text-muted">Buscando…</p>
        ) : data.profile.length === 0 ? (
          <p className="px-1 text-[12.5px] leading-relaxed text-muted">
            Todavía no hay datos para comparar. Cuando el contacto diga una zona, un presupuesto, un tipo de propiedad o una operación, aparecen acá. También podés cargarlos con el botón de ajustes.
          </p>
        ) : list.length === 0 ? (
          <p className="px-1 text-[12.5px] leading-relaxed text-muted">{tab === "cartera" ? "Ninguna propiedad de tu cartera encaja lo suficiente todavía." : "Ninguna propiedad de la red encaja lo suficiente todavía."}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {list.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!s.link}
                  onClick={() => s.link && onPick(s.link)}
                  title={s.link ? "Cargar el enlace en el mensaje" : "Esta propiedad no tiene un enlace para enviar"}
                  className={cn("w-full rounded-xl border border-line p-2.5 text-left transition-colors", s.link ? "hover:border-primary/40 hover:bg-field/60" : "cursor-not-allowed opacity-70")}
                >
                  <span className="flex gap-2.5">
                    {s.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- fotos en dominios https arbitrarios
                      <img src={s.thumb} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="size-14 shrink-0 rounded-lg bg-field" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[12.5px] font-medium text-ink">{s.title}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted">{[s.zone, s.propertyType].filter(Boolean).join(" · ")}</span>
                      <span className="block text-[12px] font-semibold tabular-nums text-ink">{money(s)}</span>
                    </span>
                  </span>
                  <span className="mt-2 flex items-center gap-2">
                    <span className={cn("rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums", BAND_TONE[s.band])}>{s.score}% compatibilidad</span>
                    <span className="text-[10.5px] text-muted" title="Cuánto sabemos de lo que busca el contacto">
                      confianza {Math.round(s.confidence * 100)}%
                    </span>
                  </span>
                  <span className="sr-only">{BAND_LABEL[s.band]}</span>
                  <ul className="mt-1.5 flex flex-col gap-0.5 text-[11.5px] leading-snug">
                    {s.matched.slice(0, 4).map((m) => (
                      <li key={`m${m}`} className="text-ink"><span className="text-accent-green">✓</span> {m}</li>
                    ))}
                    {s.conflicting.slice(0, 3).map((m) => (
                      <li key={`c${m}`} className="text-ink"><span className="text-accent-red">✗</span> {m}</li>
                    ))}
                    {s.missing.slice(0, 2).map((m) => (
                      <li key={`x${m}`} className="text-muted"><span className="text-accent-amber">△</span> {m}</li>
                    ))}
                  </ul>
                  {!s.link && (
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-accent-amber">
                      <Link2Off className="size-3" strokeWidth={1.8} /> Sin enlace
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
