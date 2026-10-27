import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { THEMES, type ThemeId } from "@/lib/themes";

/** A small four-tone preview of a theme: canvas, rail, accent and text. */
export function ThemeSwatch({ swatch, className }: { swatch: readonly string[]; className?: string }) {
  const [canvas, rail, accent, text] = swatch;
  return (
    <span
      aria-hidden="true"
      className={cn("relative block h-8 w-12 shrink-0 overflow-hidden rounded-md border border-black/15", className)}
      style={{ backgroundColor: canvas }}
    >
      <span className="absolute inset-y-0 left-0 w-3" style={{ backgroundColor: rail }} />
      <span className="absolute left-[18px] top-1.5 h-1.5 w-5 rounded-full" style={{ backgroundColor: text, opacity: 0.85 }} />
      <span className="absolute left-[18px] top-[17px] h-1.5 w-3.5 rounded-full" style={{ backgroundColor: accent }} />
      <span className="absolute bottom-1 left-[18px] h-1 w-6 rounded-full" style={{ backgroundColor: text, opacity: 0.3 }} />
    </span>
  );
}

/** The list of themes. Used inside the header popover; each option is a radio with a visible check. */
export function ThemePicker({ onPicked }: { onPicked?: (id: ThemeId) => void }) {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid gap-1" data-testid="theme-picker">
      {THEMES.map((t) => {
        const selected = t.id === theme;
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              setTheme(t.id);
              onPicked?.(t.id);
            }}
            className={cn(
              "os-theme-option flex w-full items-center gap-3 rounded-lg border px-2 py-1.5 text-left transition-colors",
              selected
                ? "border-[var(--t-accent-line)] bg-[var(--t-accent-dim)]"
                : "border-transparent hover:bg-[var(--t-hover)]",
            )}
            data-testid={`theme-option-${t.id}`}
          >
            <ThemeSwatch swatch={t.swatch} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-[var(--t-heading)]">{t.label}</span>
              <span className="block truncate text-xs text-[var(--t-muted)]">
                {t.note && t.note !== "Light" ? `${t.dark ? "Dark" : "Light"} · ${t.note}` : t.dark ? "Dark" : "Light"}
              </span>
            </span>
            {selected && <Check className="h-4 w-4 shrink-0 text-[var(--t-accent-text)]" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
