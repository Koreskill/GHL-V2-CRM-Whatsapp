"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createClient } from "@/app/(app)/agencia/actions";
import { PasswordField } from "@/components/ui/password-field";
import { toSlug } from "@/lib/agency/slug";

function Field({
  id,
  name,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  hint,
  required = true,
}: {
  id: string;
  name: string;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-[13px] font-medium text-ink" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1.5 h-10 w-full rounded-lg border border-line bg-field px-3 text-[14px] text-ink focus:border-primary focus:outline-none"
      />
      {hint && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-4 text-[14px] font-medium text-white hover:bg-primary-hover disabled:opacity-60"
    >
      {pending ? "Creando…" : "Crear cliente"}
    </button>
  );
}

export function NewClientForm() {
  const [name, setName] = useState("");
  // El identificador sigue al nombre hasta que lo tocan a mano.
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");

  return (
    <form action={createClient} className="flex flex-col gap-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Inmobiliaria</p>

      <Field
        id="name"
        name="name"
        label="Nombre"
        value={name}
        placeholder="Kore Inmobiliaria"
        onChange={(v) => {
          setName(v);
          if (!slugTouched) setSlug(toSlug(v));
        }}
      />

      <Field
        id="slug"
        name="slug"
        label="Identificador"
        value={slug}
        placeholder="kore-inmobiliaria"
        hint="Solo letras, números y guiones. Se usa internamente y no se puede repetir."
        onChange={(v) => {
          setSlugTouched(true);
          setSlug(toSlug(v));
        }}
      />

      <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
        Usuario administrador
      </p>

      <Field
        id="fullName"
        name="fullName"
        label="Nombre de la persona"
        value={fullName}
        placeholder="Benjamín Cortés"
        required={false}
        onChange={setFullName}
      />

      <Field
        id="email"
        name="email"
        label="Email"
        type="email"
        value={email}
        placeholder="persona@inmobiliaria.com"
        hint="Con este email entra al CRM: es también su nombre de usuario."
        onChange={setEmail}
      />

      <PasswordField
        id="password"
        label="Contraseña"
        autoComplete="new-password"
        withGenerator
        minLength={10}
        hint="Mínimo 10 caracteres. Usa el ojo para verla y pasársela al cliente."
      />

      <Submit />
    </form>
  );
}
