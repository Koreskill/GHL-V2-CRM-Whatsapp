import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex items-end justify-between gap-6 border-b border-line pb-6">
      <div>
        <h1 className="text-[30px] leading-tight font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </div>
  );
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-card border border-line bg-card shadow-card", className)}
      {...props}
    />
  );
}

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13.5px] font-medium transition-colors",
        variant === "primary"
          ? "bg-primary text-white hover:bg-primary-hover"
          : "border border-line bg-card text-ink hover:bg-field",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <span className="mb-4 grid size-14 place-items-center rounded-full bg-field text-muted">
        <Icon className="size-6" strokeWidth={1.6} />
      </span>
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      <div className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-muted">{description}</div>
    </div>
  );
}
