import { Eye, Globe, PauseCircle } from "lucide-react";
import { pauseProperty, publishProperty, savePublicationSettings } from "@/app/(app)/propiedades/publicacion-actions";
import { Button, Card } from "@/components/ui/primitives";
import { CopyLinkButton } from "./copy-link-button";
import type { Publication } from "@/lib/publications/queries";
import { cn } from "@/lib/utils";

const STATUS: Record<string, { label: string; tone: string }> = {
  borrador: { label: "Borrador", tone: "bg-field text-muted" },
  publicada: { label: "Publicada", tone: "bg-accent-green/12 text-accent-green" },
  pausada: { label: "Pausada", tone: "bg-accent-amber/12 text-accent-amber" },
};

/** Publicación de la ficha pública: el estado editorial vive aparte de la propiedad y no lo toca la hoja. */
export function PublishPanel({
  propertyId,
  publication,
  blockers,
}: {
  propertyId: string;
  publication: Publication | null;
  blockers: string[];
}) {
  const status = publication?.status ?? "borrador";
  const s = STATUS[status];
  const link = publication ? `/p/${publication.slug}` : null;
  const live = status === "publicada";

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Globe className="size-4 text-muted" strokeWidth={1.8} />
        <h2 className="text-[15px] font-semibold text-ink">Ficha pública</h2>
        <span className={cn("ml-auto rounded-md px-2 py-0.5 text-[11.5px] font-medium", s.tone)}>{s.label}</span>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">
        Una página sin login para compartir. Muestra solo datos comerciales: nunca notas internas, documentos ni la dirección completa.
      </p>

      {blockers.length > 0 && (
        <ul className="mt-3 list-inside list-disc rounded-lg bg-accent-amber/10 px-3 py-2 text-[12.5px] text-ink">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}

      <form className="mt-4 flex flex-col gap-3">
        <input type="hidden" name="propertyId" value={propertyId} />
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Titular (opcional)
          <input
            name="headline"
            defaultValue={publication?.headline ?? ""}
            maxLength={120}
            placeholder="Si lo dejás vacío se usa el título de la propiedad"
            className="h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Marca de la página
          <select
            name="brand"
            defaultValue={publication?.brand ?? "cowin"}
            className="h-9 rounded-lg border border-line bg-field px-2 text-[13.5px] text-ink focus:border-primary focus:outline-none"
          >
            <option value="cowin">Cowin</option>
            <option value="inmobiliaria">Mi inmobiliaria</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" name="showAddress" defaultChecked={publication?.showAddress ?? false} className="size-4 accent-[var(--color-primary)]" />
          Mostrar la dirección publicable (si no, solo zona y ciudad)
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" formAction={savePublicationSettings} variant="secondary">
            Guardar
          </Button>
          <Button type="submit" formAction={publishProperty} disabled={blockers.length > 0}>
            <Globe className="size-4" strokeWidth={1.8} />
            {live ? "Actualizar y publicar" : "Publicar"}
          </Button>
          {live && (
            <Button type="submit" formAction={pauseProperty} variant="secondary">
              <PauseCircle className="size-4" strokeWidth={1.8} />
              Pausar
            </Button>
          )}
        </div>
      </form>

      {link && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <a
            href={`${link}?preview=1`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[13px] font-medium text-ink hover:bg-field"
          >
            <Eye className="size-4" strokeWidth={1.8} />
            Previsualizar
          </a>
          {live && <CopyLinkButton path={link} />}
          {publication && (
            <span className="ml-auto text-[12px] text-muted">
              {publication.views} visitas · {publication.ctaClicks} consultas
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
