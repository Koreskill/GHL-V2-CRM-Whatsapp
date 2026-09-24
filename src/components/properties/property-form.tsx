"use client";

import { useFormStatus } from "react-dom";
import { createProperty, updateProperty } from "@/app/(app)/propiedades/actions";

const input =
  "mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[14px] text-ink focus:border-primary focus:outline-none";
const label = "block text-[13px] font-medium text-ink";
const area =
  "mt-1.5 w-full rounded-lg border border-line bg-field px-3 py-2 text-[14px] text-ink focus:border-primary focus:outline-none";

export type PropertyFormValues = {
  id?: string;
  title?: string | null;
  operation?: string;
  propertyType?: string;
  status?: string;
  price?: number | null;
  currency?: string;
  description?: string | null;
  addressPublic?: string | null;
  zone?: string | null;
  city?: string | null;
  mapUrl?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  parking?: number | null;
  areaM2?: number | null;
  areaCoveredM2?: number | null;
  amenities?: string[];
  coverUrl?: string | null;
  galleryUrls?: string[];
  videoUrl?: string | null;
  tour360Url?: string | null;
  sourceUrl?: string | null;
  internalNotes?: string | null;
};

function Submit({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-2 inline-flex h-10 w-fit items-center rounded-lg bg-primary px-4 text-[14px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear propiedad"}
    </button>
  );
}

function Field({
  name,
  label: text,
  defaultValue,
  placeholder,
  hint,
  type = "text",
  required = false,
}: {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  hint?: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className={label} htmlFor={name}>
        {text}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className={input}
      />
      {hint && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

export function PropertyForm({ values, fromSheet }: { values: PropertyFormValues; fromSheet: boolean }) {
  const editing = Boolean(values.id);

  return (
    <form action={editing ? updateProperty : createProperty} className="flex flex-col gap-5">
      {editing && <input type="hidden" name="propertyId" value={values.id} />}

      {/* Si viene de la hoja, guardar la saca del control de la sincronización. Conviene
          decirlo ANTES de que empiece a escribir, no después de guardar. */}
      {fromSheet && (
        <p className="rounded-lg bg-accent-amber/10 px-3 py-2.5 text-[13px] leading-relaxed text-ink">
          Esta propiedad viene de la hoja de Google. Si la guardás editada, la sincronización deja de
          pisarla y tus cambios mandan, hasta que uses «Volver a sincronizar» en su ficha.
        </p>
      )}

      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Identificación</p>

      <Field name="title" label="Título" defaultValue={values.title} required placeholder="Depto 2 amb en Palermo" />

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className={label} htmlFor="operation">
            Operación
          </label>
          <select id="operation" name="operation" defaultValue={values.operation ?? "venta"} className={input}>
            <option value="venta">Venta</option>
            <option value="alquiler">Alquiler</option>
            <option value="temporario">Temporario</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="propertyType">
            Tipo
          </label>
          <select
            id="propertyType"
            name="propertyType"
            defaultValue={values.propertyType ?? "departamento"}
            className={input}
          >
            <option value="departamento">Departamento</option>
            <option value="casa">Casa</option>
            <option value="ph">PH</option>
            <option value="terreno">Terreno</option>
            <option value="local">Local</option>
            <option value="oficina">Oficina</option>
            <option value="cochera">Cochera</option>
            <option value="otro">Otro</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="status">
            Estado
          </label>
          <select id="status" name="status" defaultValue={values.status ?? "disponible"} className={input}>
            <option value="disponible">Disponible</option>
            <option value="reservada">Reservada</option>
            <option value="vendida">Vendida</option>
            <option value="alquilada">Alquilada</option>
            <option value="pausada">Pausada</option>
            <option value="borrador">Borrador</option>
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <Field name="price" label="Precio" defaultValue={values.price} placeholder="120000" />
        <div>
          <label className={label} htmlFor="currency">
            Moneda
          </label>
          <select id="currency" name="currency" defaultValue={values.currency ?? "USD"} className={input}>
            <option value="USD">USD</option>
            <option value="ARS">ARS</option>
          </select>
        </div>
      </div>

      <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Ubicación</p>

      <Field
        name="addressPublic"
        label="Dirección publicable"
        defaultValue={values.addressPublic}
        hint="La que se le puede pasar al cliente. La dirección exacta va en observaciones internas."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="zone" label="Barrio" defaultValue={values.zone} />
        <Field name="city" label="Ciudad" defaultValue={values.city} />
      </div>
      <Field name="mapUrl" label="Enlace al mapa" type="url" defaultValue={values.mapUrl} placeholder="https://…" />

      <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Características</p>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field name="bedrooms" label="Dormitorios" defaultValue={values.bedrooms} />
        <Field name="bathrooms" label="Baños" defaultValue={values.bathrooms} />
        <Field name="parking" label="Cocheras" defaultValue={values.parking} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="areaM2" label="Superficie total (m²)" defaultValue={values.areaM2} />
        <Field name="areaCoveredM2" label="Superficie cubierta (m²)" defaultValue={values.areaCoveredM2} />
      </div>
      <div>
        <label className={label} htmlFor="amenities">
          Amenities
        </label>
        <input
          id="amenities"
          name="amenities"
          defaultValue={values.amenities?.join(", ") ?? ""}
          placeholder="Pileta, SUM, parrilla"
          className={input}
        />
        <p className="mt-1.5 text-[12px] text-muted">Separados por coma.</p>
      </div>

      <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Contenido</p>

      <div>
        <label className={label} htmlFor="description">
          Descripción
        </label>
        <textarea id="description" name="description" rows={4} defaultValue={values.description ?? ""} className={area} />
      </div>

      <Field
        name="coverUrl"
        label="URL de portada"
        type="url"
        defaultValue={values.coverUrl}
        placeholder="https://…"
        hint="Tiene que ser un enlace https a la imagen. Una foto pegada en una celda no sirve."
      />
      <div>
        <label className={label} htmlFor="galleryUrls">
          URLs de galería
        </label>
        <textarea
          id="galleryUrls"
          name="galleryUrls"
          rows={3}
          defaultValue={values.galleryUrls?.join("\n") ?? ""}
          placeholder={"https://…\nhttps://…"}
          className={area}
        />
        <p className="mt-1.5 text-[12px] text-muted">Una por línea. Las que no sean https se descartan.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="videoUrl" label="URL de video" type="url" defaultValue={values.videoUrl} placeholder="https://…" />
        <Field name="tour360Url" label="URL de tour 360°" type="url" defaultValue={values.tour360Url} placeholder="https://…" />
      </div>
      <Field
        name="sourceUrl"
        label="Enlace a la ficha completa"
        type="url"
        defaultValue={values.sourceUrl}
        placeholder="https://…"
        hint="El aviso original o la ficha publicada."
      />

      <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Interno</p>

      <div>
        <label className={label} htmlFor="internalNotes">
          Observaciones internas
        </label>
        <textarea
          id="internalNotes"
          name="internalNotes"
          rows={3}
          defaultValue={values.internalNotes ?? ""}
          className={area}
        />
        <p className="mt-1.5 text-[12px] text-muted">
          Solo las ve tu equipo. No se comparten ni entran al contexto del agente.
        </p>
      </div>

      <Submit editing={editing} />
    </form>
  );
}
