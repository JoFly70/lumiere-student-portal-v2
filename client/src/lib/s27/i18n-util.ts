/** Small i18n helpers for the S27 screens (plural keys `base.one` / `base.other`). */
import { useCallback } from "react";
import { useT, type Language, type TranslationKey } from "@/i18n";

export type TFn = (key: TranslationKey, vars?: Record<string, string | number>) => string;

/** French uses the singular for 0 and 1; English only for 1. */
export function isOne(n: number, lang: Language): boolean {
  return n === 1 || (lang === "fr" && n === 0);
}

export function plural(t: TFn, lang: Language, base: string, n: number, vars: Record<string, string | number> = {}): string {
  return t(`${base}.${isOne(n, lang) ? "one" : "other"}` as TranslationKey, { n, ...vars });
}

/** `const { t, lang, pl } = useS27T()` */
export function useS27T() {
  const { t, language } = useT();
  const lang: "en" | "fr" = language === "fr" ? "fr" : "en";
  const pl = useCallback((base: string, n: number, vars: Record<string, string | number> = {}) => plural(t, language, base, n, vars), [t, language]);
  const num = useCallback((n: number, digits = 1) => new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n), [lang]);
  return { t, lang, pl, num };
}
