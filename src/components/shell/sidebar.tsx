"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronDown,
  FileText,
  GitBranch,
  LayoutGrid,
  MapPin,
  MessageCircle,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label?: string; items: NavItem[] };

const groups: NavGroup[] = [
  { items: [{ href: "/", label: "Dashboard", icon: LayoutGrid }] },
  {
    label: "Operaciones",
    items: [
      { href: "/pipeline", label: "Pipeline", icon: GitBranch },
      { href: "/contactos", label: "Contactos", icon: Users },
      { href: "/conversaciones", label: "Conversaciones", icon: MessageCircle },
      { href: "/plantillas", label: "Plantillas", icon: FileText },
      { href: "/visitas", label: "Visitas", icon: MapPin },
    ],
  },
  {
    label: "Productividad",
    items: [
      { href: "/actividades", label: "Actividades", icon: Activity },
      { href: "/calendario", label: "Calendario", icon: CalendarDays },
    ],
  },
  {
    label: "Inteligencia",
    items: [{ href: "/reportes", label: "Reportes", icon: BarChart3 }],
  },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors",
        active
          ? "bg-shell-active text-shell-text"
          : "text-shell-muted hover:bg-white/5 hover:text-shell-text",
      )}
    >
      <Icon className="size-[18px]" strokeWidth={1.6} />
      {item.label}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col bg-shell px-3 py-5">
      <div className="mb-6 flex items-center gap-2.5 px-3">
        <span className="grid size-7 place-items-center rounded-full bg-accent-orange/15">
          <span className="size-3 rounded-full bg-accent-orange" />
        </span>
        <span className="text-[16px] font-semibold text-shell-text">Setter CRM</span>
      </div>

      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto">
        {groups.map((group, i) => (
          <div key={group.label ?? i} className="flex flex-col gap-0.5">
            {group.label && (
              <p className="mb-1.5 px-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-shell-muted/80">
                {group.label}
              </p>
            )}
            {group.items.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-4 flex flex-col gap-3 border-t border-white/5 pt-4">
        <NavLink
          item={{ href: "/configuracion", label: "Configuración", icon: Settings }}
          active={isActive("/configuracion")}
        />
        <button className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/5">
          <span className="relative grid size-8 place-items-center rounded-full bg-shell-active text-[12px] font-semibold text-shell-text">
            BC
            <span className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-shell bg-accent-green" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-medium text-shell-text">
              Benjamin Cortes
            </span>
            <span className="block truncate text-[11.5px] text-shell-muted">
              nexkore.arg@gmail.com
            </span>
          </span>
          <ChevronDown className="size-4 text-shell-muted" strokeWidth={1.6} />
        </button>
      </div>
    </aside>
  );
}
