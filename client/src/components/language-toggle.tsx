import { Languages } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGUAGES, useLanguage, useT } from "@/i18n";

/**
 * Compact EN / FR switch for the shell headers. Mirrors ThemeToggle placement; every target is 44px.
 * Uses a radiogroup so assistive tech reads the current language.
 */
export function LanguageToggle({ className }: { className?: string } = {}) {
  const { language, setLanguage } = useLanguage();
  const { t } = useT();
  return (
    <div
      role="radiogroup"
      aria-label={t("language.label")}
      className={cn("inline-flex items-center rounded-md border border-student-line", className)}
      data-testid="language-toggle"
    >
      <Languages className="ml-2 h-4 w-4 text-student-muted" aria-hidden="true" />
      {LANGUAGES.map((l) => {
        const active = l.code === language;
        return (
          <button
            key={l.code}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={l.label}
            lang={l.code}
            onClick={() => setLanguage(l.code)}
            data-testid={`button-language-${l.code}`}
            className={cn(
              "inline-flex h-11 min-w-11 items-center justify-center rounded-md px-2 text-xs font-semibold tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
              active ? "bg-student-gold-soft text-student-gold-ink" : "text-student-muted hover:text-student-gold-ink",
            )}
          >
            {l.short}
          </button>
        );
      })}
    </div>
  );
}
