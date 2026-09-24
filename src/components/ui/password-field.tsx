"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Sin ambigüedades visuales (0/O, 1/l/I): la contraseña se dicta o se copia a mano.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generate(length = 14) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => ALPHABET[n % ALPHABET.length]).join("");
}

/**
 * Campo de contraseña con ojo para ver lo que se escribe.
 * El ojo muestra lo TIPEADO en este campo: la contraseña guardada no se puede mostrar
 * en ningún lado, Supabase guarda un hash y nadie (tampoco el administrador) la puede leer.
 */
export function PasswordField({
  id,
  name = "password",
  label = "Contraseña",
  autoComplete = "current-password",
  withGenerator = false,
  hint,
  required = true,
  minLength,
  className,
}: {
  id?: string;
  name?: string;
  label?: string;
  autoComplete?: string;
  withGenerator?: boolean;
  hint?: string;
  required?: boolean;
  minLength?: number;
  className?: string;
}) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const [visible, setVisible] = useState(false);
  const [value, setValue] = useState("");

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-3">
        <label className="block text-[13px] font-medium text-ink" htmlFor={fieldId}>
          {label}
        </label>
        {withGenerator && (
          <button
            type="button"
            onClick={() => {
              setValue(generate());
              setVisible(true);
            }}
            className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
          >
            <RefreshCw className="size-3" strokeWidth={2} />
            Generar
          </button>
        )}
      </div>

      <div className="relative mt-1.5">
        <input
          id={fieldId}
          name={name}
          type={visible ? "text" : "password"}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={cn(
            "h-10 w-full rounded-lg border border-line bg-field pl-3 pr-10 text-[14px] text-ink focus:border-primary focus:outline-none",
            visible && "font-mono tracking-tight",
          )}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar contraseña" : "Ver contraseña"}
          title={visible ? "Ocultar contraseña" : "Ver contraseña"}
          aria-pressed={visible}
          className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted hover:text-ink"
        >
          {visible ? <EyeOff className="size-4" strokeWidth={1.7} /> : <Eye className="size-4" strokeWidth={1.7} />}
        </button>
      </div>

      {hint && <p className="mt-1.5 text-[12px] text-muted">{hint}</p>}
    </div>
  );
}
