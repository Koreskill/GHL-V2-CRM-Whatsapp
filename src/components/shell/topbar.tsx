import { Bell, Search } from "lucide-react";

export function Topbar() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line bg-card px-8">
      <label className="flex h-10 w-full max-w-xl items-center gap-2.5 rounded-xl bg-field px-3.5 text-muted">
        <Search className="size-4" strokeWidth={1.8} />
        <input
          type="search"
          placeholder="Buscar contactos, conversaciones..."
          className="flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none"
        />
        <kbd className="rounded-md border border-line bg-card px-1.5 py-0.5 text-[11px] font-medium text-muted">
          ⌘ K
        </kbd>
      </label>
      <button
        aria-label="Notificaciones"
        className="ml-auto grid size-9 place-items-center rounded-lg text-muted hover:bg-field hover:text-ink"
      >
        <Bell className="size-[18px]" strokeWidth={1.7} />
      </button>
    </header>
  );
}
