import { useMemo } from "react";
import { useLanguage } from "@/i18n";
import { localeFor, makeT, type TFn } from "./ops-helpers";

/** Translate function for the S30 keys (plain string keys: the module is wired into the dictionaries by the shell). */
export function useOpsT(): { t: TFn; language: string; locale: string } {
  const { language } = useLanguage();
  return useMemo(() => ({ t: makeT(language), language, locale: localeFor(language) }), [language]);
}
