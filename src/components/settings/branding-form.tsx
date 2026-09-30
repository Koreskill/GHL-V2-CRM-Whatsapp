import { saveBranding } from "@/app/(app)/propiedades/publicacion-actions";
import { Button } from "@/components/ui/primitives";
import { BRAND_COLORS, type Branding } from "@/lib/publications/logic";
import { cn } from "@/lib/utils";

const field = "h-9 rounded-lg border border-line bg-field px-3 text-[13.5px] text-ink focus:border-primary focus:outline-none";

export function BrandingForm({ branding }: { branding: Branding }) {
  return (
    <form action={saveBranding} className="grid max-w-2xl gap-4">
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        Nombre que se muestra
        <input name="name" defaultValue={branding.name ?? ""} maxLength={80} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        Logo (enlace https a una imagen)
        <input name="logoUrl" defaultValue={branding.logoUrl ?? ""} maxLength={500} inputMode="url" className={field} />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          WhatsApp de contacto (con código de país)
          <input name="phone" defaultValue={branding.phone ?? ""} placeholder="5493417857073" inputMode="tel" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-[12.5px] text-muted">
          Email de contacto
          <input name="email" type="email" defaultValue={branding.email ?? ""} maxLength={120} className={field} />
        </label>
      </div>
      <fieldset>
        <legend className="mb-1.5 text-[12.5px] text-muted">Color de marca (si la página usa la de tu inmobiliaria)</legend>
        <div className="flex flex-wrap gap-2">
          {BRAND_COLORS.map((c) => (
            <label key={c.id} title={c.label} className="cursor-pointer">
              <input type="radio" name="colorId" value={c.id} defaultChecked={branding.colorId === c.id} className="peer sr-only" />
              <span style={{ backgroundColor: c.hex }} className={cn("block size-8 rounded-full ring-offset-2 ring-offset-card peer-checked:ring-2 peer-focus-visible:ring-2 ring-ink")} />
              <span className="sr-only">{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-[12.5px] text-muted">
        Aviso legal (aparece al pie de cada ficha)
        <textarea name="legal" defaultValue={branding.legal ?? ""} maxLength={600} rows={3} className={cn(field, "h-auto py-2")} />
      </label>
      <div>
        <Button type="submit">Guardar marca</Button>
      </div>
    </form>
  );
}
