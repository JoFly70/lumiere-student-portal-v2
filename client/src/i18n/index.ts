/**
 * Dependency-free i18n (S18). API shaped like react-i18next's `useTranslation().t`
 * so it can be swapped later: `const { t } = useT()` -> `t("nav.billing")`, `t("flightDeck.greeting", { name })`.
 * Lookup order: current language -> English -> the key itself.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type TranslationKey } from "./en";
import { fr } from "./fr";

export type { TranslationKey };
export type Language = "en" | "fr";

export const LANGUAGES: ReadonlyArray<{ code: Language; label: string; short: string }> = [
  { code: "en", label: "English", short: "EN" },
  { code: "fr", label: "Français", short: "FR" },
];

export const LANGUAGE_STORAGE_KEY = "lumiere_language";
export const DEFAULT_LANGUAGE: Language = "en";

const DICTIONARIES: Record<Language, Record<string, string>> = { en, fr };

export function isLanguage(value: unknown): value is Language {
  return value === "en" || value === "fr";
}

/** Reads the saved language. Never throws (private mode / blocked storage). */
export function readStoredLanguage(storage?: Pick<Storage, "getItem">): Language {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    const v = s?.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(v) ? v : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** Saves the language. Returns false if storage is unavailable; the UI still works for this session. */
export function writeStoredLanguage(lang: Language, storage?: Pick<Storage, "setItem">): boolean {
  try {
    const s = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    if (!s) return false;
    s.setItem(LANGUAGE_STORAGE_KEY, lang);
    return true;
  } catch {
    return false;
  }
}

/** Pure translate function (used by the hook and by tests). */
export function translate(lang: Language, key: string, vars?: Record<string, string | number>): string {
  const template = DICTIONARIES[lang]?.[key] ?? DICTIONARIES.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/**
 * Credits for display. `half` is the half-unit integer; `formatted` is the output of formatHalfUnits
 * ("0.5", "2"). French uses a decimal comma: "0,5". Presentation only.
 */
export function formatCreditsLocale(half: number, lang: Language): string {
  if (!Number.isInteger(half)) throw new RangeError(`Half-units must be an integer (got ${half})`);
  const sign = half < 0 ? "-" : "";
  const abs = Math.abs(half);
  const whole = Math.floor(abs / 2);
  const text = abs % 2 === 0 ? `${sign}${whole}` : `${sign}${whole}.5`; // identical to formatHalfUnits
  return lang === "fr" ? text.replace(".", ",") : text;
}

interface I18nContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
}

const I18nContext = createContext<I18nContextValue>({ language: DEFAULT_LANGUAGE, setLanguage: () => {} });

export function I18nProvider({ children, initialLanguage }: { children: ReactNode; initialLanguage?: Language }) {
  const [language, setLang] = useState<Language>(() => initialLanguage ?? readStoredLanguage());

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((lang: Language) => {
    if (!isLanguage(lang)) return;
    setLang(lang);
    writeStoredLanguage(lang);
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useLanguage(): I18nContextValue {
  return useContext(I18nContext);
}

export function useT() {
  const { language } = useContext(I18nContext);
  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );
  return { t, language, formatCredits: (half: number) => formatCreditsLocale(half, language) };
}
