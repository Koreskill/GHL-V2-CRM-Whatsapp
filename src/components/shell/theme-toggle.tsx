"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark" | "system";
const KEY = "crm_theme";

const OPTIONS: { id: Theme; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "Claro", Icon: Sun },
  { id: "dark", label: "Oscuro", Icon: Moon },
  { id: "system", label: "Sistema", Icon: Monitor },
];

function apply(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

function read(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {}
  return "system";
}

export function ThemeToggle() {
  // La preferencia vive en localStorage; en el servidor se asume "system" y el cliente la corrige al hidratar.
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);

  // Con "Sistema" el tema sigue al del equipo aunque cambie con la página abierta.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function choose(next: Theme) {
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    apply(next);
    listeners.forEach((cb) => cb());
  }

  return (
    <div role="radiogroup" aria-label="Tema" className="flex shrink-0 items-center gap-0.5 rounded-xl bg-field p-0.5">
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={theme === id}
          title={label}
          onClick={() => choose(id)}
          className={cn(
            "grid size-8 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-primary",
            theme === id ? "bg-card text-ink shadow-card" : "text-muted hover:text-ink",
          )}
        >
          <Icon className="size-4" strokeWidth={1.8} />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
