import { initialsFor } from "@/lib/domain/athletes";

type Size = "sm" | "md" | "lg" | "xl";

const SIZE: Record<Size, string> = {
  sm: "w-7 h-7 text-[10px]",
  md: "w-10 h-10 text-xs",
  lg: "w-14 h-14 text-sm",
  xl: "w-20 h-20 text-lg",
};

export function AthleteMonogram({
  name,
  size = "md",
  className = "",
}: {
  name: string;
  size?: Size;
  className?: string;
}) {
  const initials = initialsFor(name);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-amber/10 border border-amber/30 text-amber font-serif-display tracking-wider ${SIZE[size]} ${className}`}
      aria-hidden
    >
      {initials}
    </span>
  );
}
