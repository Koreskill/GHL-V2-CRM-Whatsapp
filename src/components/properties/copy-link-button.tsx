"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

// El origen sale del navegador: la URL pública es la misma que está usando quien la copia.
export function CopyLinkButton({ path }: { path: string }) {
  const [done, setDone] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      window.prompt("Copiá el enlace:", url);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[13px] font-medium text-ink hover:bg-field"
    >
      {done ? <Check className="size-4 text-accent-green" strokeWidth={2} /> : <Copy className="size-4" strokeWidth={1.8} />}
      {done ? "Copiado" : "Copiar enlace"}
    </button>
  );
}
