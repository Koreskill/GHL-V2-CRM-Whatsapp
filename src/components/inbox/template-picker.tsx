"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, SendHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";

type Template = { name: string; language: string; category: string | null; body: string; params: number };

export function TemplatePicker({
  conversationId,
  onSend,
  onClose,
}: {
  conversationId: string;
  onSend: (t: { name: string; language: string; params: string[] }, preview: string) => void;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Template | null>(null);
  const [params, setParams] = useState<string[]>([]);

  useEffect(() => {
    fetch(`/api/templates?conversationId=${conversationId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok) throw new Error(data?.error ?? "No se pudieron leer las plantillas");
        setTemplates(data.templates);
      })
      .catch((e: Error) => setError(e.message));
  }, [conversationId]);

  const preview = selected ? selected.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => params[Number(n) - 1] || m) : "";
  const ready = selected && params.length === selected.params && params.every((p) => p.trim());

  return (
    <div className="mb-3 rounded-xl border border-line bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="size-4 text-muted" strokeWidth={1.7} />
        <p className="text-[13.5px] font-semibold text-ink">Enviar plantilla aprobada</p>
        <button onClick={onClose} aria-label="Cerrar" className="ml-auto grid size-7 place-items-center rounded-md text-muted hover:bg-field hover:text-ink">
          <X className="size-4" />
        </button>
      </div>

      {error && <p className="text-[13px] text-accent-red">{error}</p>}
      {!templates && !error && <Loader2 className="size-4 animate-spin text-muted" />}
      {templates?.length === 0 && (
        <p className="text-[13px] text-muted">No hay plantillas aprobadas todavía. Créalas en Plantillas y espera la aprobación de Meta.</p>
      )}

      {templates && templates.length > 0 && (
        <>
          <select
            value={selected ? `${selected.name}|${selected.language}` : ""}
            onChange={(e) => {
              const t = templates.find((x) => `${x.name}|${x.language}` === e.target.value) ?? null;
              setSelected(t);
              setParams(t ? Array.from({ length: t.params }, () => "") : []);
            }}
            className="h-9 w-full rounded-lg border border-line bg-field px-3 text-[13px] text-ink focus:border-primary focus:outline-none"
          >
            <option value="">Elegir plantilla…</option>
            {templates.map((t) => (
              <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                {t.name} ({t.language})
              </option>
            ))}
          </select>

          {selected && (
            <div className="mt-3 flex flex-col gap-2">
              {params.map((value, i) => (
                <input
                  key={i}
                  value={value}
                  maxLength={1024}
                  onChange={(e) => setParams((prev) => prev.map((p, j) => (j === i ? e.target.value : p)))}
                  placeholder={`Variable {{${i + 1}}}`}
                  className="h-9 rounded-lg border border-line bg-field px-3 text-[13px] text-ink focus:border-primary focus:outline-none"
                />
              ))}
              <p className="rounded-lg bg-field px-3 py-2 text-[13px] whitespace-pre-wrap text-ink">{preview}</p>
              <Button
                className="self-end"
                disabled={!ready}
                onClick={() => {
                  if (!selected || !ready) return;
                  onSend({ name: selected.name, language: selected.language, params }, preview);
                }}
              >
                <SendHorizontal className="size-4" strokeWidth={1.8} /> Enviar plantilla
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
