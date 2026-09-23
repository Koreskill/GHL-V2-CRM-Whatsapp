"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Link2, Loader2, RefreshCw } from "lucide-react";
import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

export type AccountRow = {
  id: string;
  channel: Channel;
  name: string | null;
  handle: string | null;
  status: string;
  historyImportedAt: string | null;
};

const CHANNELS: Channel[] = ["whatsapp", "instagram", "facebook"];

export function AccountsPanel({ accounts }: { accounts: AccountRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "zernio-connected") return;
      setNotice(e.data.ok ? { tone: "ok", text: "Cuenta conectada. El historial se está importando." } : { tone: "error", text: "La conexión no se completó." });
      router.refresh();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router]);

  function connect(channel: Channel) {
    // La ventana se abre SÍNCRONA con el click: si se abre después del await, el navegador la bloquea.
    const popup = window.open("about:blank", "zernio-connect", "width=620,height=760");
    setBusy(`connect:${channel}`);
    setNotice(null);
    fetch(`/api/accounts/connect?platform=${channel}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (!r.ok || !data?.authUrl) throw new Error(data?.error ?? "No se pudo iniciar la conexión");
        if (popup) popup.location.href = data.authUrl;
        else window.location.href = data.authUrl;
      })
      .catch((err: Error) => {
        popup?.close();
        setNotice({ tone: "error", text: err.message });
      })
      .finally(() => setBusy(null));
  }

  async function post(url: string, key: string, ok: string) {
    setBusy(key);
    setNotice(null);
    const r = await fetch(url, { method: "POST" }).catch(() => null);
    const data = r ? await r.json().catch(() => null) : null;
    setNotice(r?.ok ? { tone: "ok", text: ok } : { tone: "error", text: data?.error ?? "No se pudo completar" });
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p className={cn("rounded-lg px-3 py-2 text-[13px]", notice.tone === "ok" ? "bg-accent-green/10 text-ink" : "bg-accent-red/10 text-accent-red")}>
          {notice.text}
        </p>
      )}

      <div className="grid grid-cols-3 gap-5">
        {CHANNELS.map((channel) => {
          const { Icon, color, label } = CHANNEL_META[channel];
          const connected = accounts.filter((a) => a.channel === channel);
          return (
            <div key={channel} className="rounded-card border border-line bg-card p-5 shadow-card">
              <div className="flex items-center gap-2.5">
                <span className="grid size-9 place-items-center rounded-full bg-field">
                  <Icon className={cn("size-5", color)} />
                </span>
                <p className="text-[15px] font-semibold text-ink">{label}</p>
              </div>

              <ul className="mt-4 flex min-h-12 flex-col gap-2">
                {connected.length === 0 && <li className="text-[13px] text-muted">Sin cuentas conectadas.</li>}
                {connected.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 rounded-lg bg-field px-3 py-2">
                    <span className={cn("size-2 shrink-0 rounded-full", a.status === "connected" ? "bg-accent-green" : "bg-accent-red")} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{a.handle ?? a.name ?? "Cuenta"}</span>
                      <span className="block text-[11.5px] text-muted">
                        {a.status !== "connected" ? "Desconectada" : a.historyImportedAt ? "Historial importado" : "Importando historial…"}
                      </span>
                    </span>
                    {a.status === "connected" && (
                      <button
                        onClick={() => post(`/api/accounts/${a.id}/import`, `import:${a.id}`, "Importando historial en segundo plano.")}
                        disabled={busy !== null}
                        title="Volver a importar el historial"
                        className="grid size-7 place-items-center rounded-md text-muted hover:bg-card hover:text-ink disabled:opacity-40"
                      >
                        {busy === `import:${a.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <Button variant="secondary" className="mt-4 w-full justify-center" onClick={() => connect(channel)} disabled={busy !== null}>
                {busy === `connect:${channel}` ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" strokeWidth={1.7} />}
                {connected.length ? "Conectar otra" : "Conectar"}
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => post("/api/accounts/sync", "sync", "Cuentas sincronizadas con Zernio.")} disabled={busy !== null}>
          {busy === "sync" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" strokeWidth={1.7} />}
          Sincronizar
        </Button>
      </div>
    </div>
  );
}
