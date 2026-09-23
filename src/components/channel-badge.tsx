import { CHANNEL_META, type Channel } from "@/components/channel-icons";
import { cn } from "@/lib/utils";

export function ChannelBadge({ channel, text, className }: { channel: Channel; text?: string | null; className?: string }) {
  const { Icon, color, label } = CHANNEL_META[channel];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-field px-2.5 py-1 text-[12px] text-ink", className)}>
      <Icon className={cn("size-3.5 shrink-0", color)} />
      <span className="truncate">{text ?? label}</span>
    </span>
  );
}
