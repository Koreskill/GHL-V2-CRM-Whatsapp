"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

// UNA sola proporción para la portada de TODAS las propiedades (catálogo, ficha y página pública). Una foto
// vertical, panorámica o una imagen que no carga ocupan exactamente el mismo marco: la grilla no se rompe.
export const COVER_ASPECT = "aspect-[16/10]";

function CoverImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="absolute inset-0 grid place-items-center">
        <span className="flex flex-col items-center gap-1 text-[12px] text-muted">
          <ImageOff className="size-5" strokeWidth={1.5} />
          No se pudo cargar la portada
        </span>
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- las portadas viven en dominios arbitrarios de la hoja
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-cover object-center"
    />
  );
}

export function PropertyCover({
  src,
  alt = "",
  className,
  children,
}: {
  src: string | null;
  alt?: string;
  className?: string;
  /** Insignias encima de la portada (estado, avisos). */
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("relative w-full overflow-hidden bg-field", COVER_ASPECT, className)}>
      {src ? (
        // key: si cambia la portada se vuelve a intentar aunque la anterior haya fallado.
        <CoverImage key={src} src={src} alt={alt} />
      ) : (
        <span className="absolute inset-0 grid place-items-center">
          <span className="flex flex-col items-center gap-1 text-[12px] text-muted">
            <ImageOff className="size-5" strokeWidth={1.5} />
            Sin portada
          </span>
        </span>
      )}
      {children}
    </div>
  );
}
