"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 4000;

// Pregunta por una VERSIÓN liviana (/api/inbox/version) y recarga la página solo si cambió. Con la
// pestaña oculta no consulta; al volver, consulta en el acto.
export function InboxAutoRefresh() {
  const router = useRouter();
  const last = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const res = await fetch("/api/inbox/version", { cache: "no-store" }).catch(() => null);
      const data = res?.ok ? ((await res.json().catch(() => null)) as { version?: string } | null) : null;
      if (!data?.version) return;
      if (last.current !== null && last.current !== data.version) router.refresh();
      last.current = data.version;
    };
    void check();
    const interval = window.setInterval(check, POLL_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [router]);

  return null;
}
