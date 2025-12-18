import { cn } from "@/lib/utils";

interface ProgressBarProps {
  value: number;
  variant?: "default" | "primary";
  className?: string;
}

export function ProgressBar({ value, variant = "default", className }: ProgressBarProps) {
  return (
    <div className={cn("h-3 w-full rounded-full bg-secondary overflow-hidden", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300",
          variant === "primary" ? "bg-primary" : "bg-chart-1"
        )}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        data-testid="progress-bar-fill"
      />
    </div>
  );
}
