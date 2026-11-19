import { ExternalLink, Link2, Megaphone } from "lucide-react";
import type { AdOrigin } from "@/lib/inbox/attribution";

/**
 * De qué anuncio (o enlace) vino la conversación. Lo guarda el webhook en el primer mensaje tras el
 * click; acá solo se muestra. El texto del anuncio es de un tercero: se renderiza como texto.
 */
export function AdOriginBanner({ origin }: { origin: AdOrigin }) {
  const isAd = origin.kind === "anuncio";
  const Icon = isAd ? Megaphone : Link2;
  const hasDetail = Boolean(origin.body || origin.adId || origin.clickId || origin.ref || origin.sourceUrl || origin.capturedAt);

  return (
    <div className="shrink-0 border-b border-line bg-field/60 px-6 py-2.5">
      <div className="flex items-start gap-2.5">
        {origin.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- miniatura externa del proveedor, sin optimizar
          <img src={origin.imageUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" referrerPolicy="no-referrer" />
        ) : (
          <Icon className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.8} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">{isAd ? "Llegó desde un anuncio" : "Llegó desde un enlace"}</p>
          <p className="truncate text-[13.5px] font-semibold text-ink">
            {origin.title ?? (isAd ? "Anuncio sin título" : (origin.ref ?? "Enlace con etiqueta"))}
          </p>
          {hasDetail && (
            <details className="mt-1 text-[12.5px] text-muted">
              <summary className="cursor-pointer text-primary">Ver detalle</summary>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {origin.body && (
                  <>
                    <dt>Texto</dt>
                    <dd className="break-words whitespace-pre-wrap text-ink">{origin.body}</dd>
                  </>
                )}
                {origin.adId && (
                  <>
                    <dt>ID del anuncio</dt>
                    <dd className="font-mono break-all text-ink">{origin.adId}</dd>
                  </>
                )}
                {origin.clickId && (
                  <>
                    <dt>ID del click</dt>
                    <dd className="font-mono break-all text-ink">{origin.clickId}</dd>
                  </>
                )}
                {origin.ref && (
                  <>
                    <dt>Etiqueta (ref)</dt>
                    <dd className="font-mono break-all text-ink">{origin.ref}</dd>
                  </>
                )}
                {origin.capturedAt && (
                  <>
                    <dt>Click</dt>
                    <dd className="text-ink">{new Date(origin.capturedAt).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}</dd>
                  </>
                )}
              </dl>
              {origin.sourceUrl && (
                <a
                  href={origin.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" strokeWidth={1.8} /> Abrir publicación
                </a>
              )}
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
