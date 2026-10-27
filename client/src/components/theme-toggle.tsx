import { useState } from "react";
import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemePicker } from "@/components/os/theme-picker";
import { themeDef } from "@/lib/themes";
import { useTheme } from "@/hooks/use-theme";

/**
 * Theme control for the shell headers. The trigger keeps the existing `button-theme-toggle` test id;
 * it opens the picker with all nine themes (selection is saved in this browser).
 */
export function ThemeToggle({ className }: { className?: string } = {}) {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          data-testid="button-theme-toggle"
          aria-label={`Choose theme (current: ${themeDef(theme).label})`}
        >
          <Palette className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Choose theme</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(20rem,calc(100vw-1.5rem))] max-h-[min(34rem,calc(100dvh-5rem))] overflow-y-auto border-[var(--t-line-2)] bg-[var(--t-panel)] p-2 text-[var(--t-text)] shadow-lg"
        data-testid="theme-popover"
      >
        <p className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--t-muted)]">Appearance</p>
        <ThemePicker onPicked={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
