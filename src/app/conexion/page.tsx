"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

// Página a la que vuelve la ventana emergente después del OAuth de Zernio.
export default function ConexionPage() {
  const [state, setState] = useState<"syncing" | "done" | "error">("syncing");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const failed = params.has("error");
    fetch("/api/accounts/sync", { method: "POST" })
      .then((r) => {
        const ok = r.ok && !failed;
        setState(ok ? "done" : "error");
        window.opener?.postMessage({ type: "zernio-connected", ok }, window.location.origin);
        if (ok) setTimeout(() => window.close(), 1500);
      })
      .catch(() => setState("error"));
  }, []);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4">
      <div className="max-w-sm rounded-card border border-line bg-card p-8 text-center shadow-card">
        {state === "syncing" && <Loader2 className="mx-auto size-8 animate-spin text-muted" />}
        {state === "done" && <CheckCircle2 className="mx-auto size-8 text-accent-green" />}
        {state === "error" && <XCircle className="mx-auto size-8 text-accent-red" />}
        <p className="mt-4 text-[15px] font-semibold text-ink">
          {state === "syncing" ? "Guardando la conexión…" : state === "done" ? "Cuenta conectada" : "No se pudo completar la conexión"}
        </p>
        <p className="mt-1.5 text-[13px] text-muted">
          {state === "done"
            ? "Estamos importando el historial. Esta ventana se cierra sola."
            : state === "error"
              ? "Cierra esta ventana y vuelve a intentarlo desde Configuración."
              : "Un momento."}
        </p>
      </div>
    </main>
  );
}
