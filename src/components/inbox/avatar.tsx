import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Avatar({
  name,
  picture,
  channel,
  size = "md",
}: {
  name: string;
  picture: string | null;
  channel: Channel;
  size?: "md" | "lg";
}) {
  const { Icon, color } = CHANNEL_META[channel];
  const box = size === "lg" ? "size-10 text-[13px]" : "size-9 text-[12px]";
  return (
    <span className={cn("relative shrink-0", box)}>
      {picture?.startsWith("https://") ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL externa del proveedor, sin optimizar
        <img src={picture} alt="" className={cn("rounded-full object-cover", box)} referrerPolicy="no-referrer" />
      ) : (
        <span className={cn("grid place-items-center rounded-full bg-field font-semibold text-muted", box)}>
          {initials(name)}
        </span>
      )}
      <span className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-card ring-2 ring-card">
        <Icon className={cn("size-3", color)} />
      </span>
    </span>
  );
}
