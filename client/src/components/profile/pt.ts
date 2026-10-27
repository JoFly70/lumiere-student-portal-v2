/**
 * Profile phrase translator (S20). The English source text is the lookup key, so English output is byte-for-byte
 * the original copy. French lives in i18n/modules/profile.ts (profileFr); tests/s20-profile-i18n.test.ts proves every
 * pt("...") literal in the profile files has a French entry and no entry is orphaned.
 * Server-recorded text (names, school names, readiness labels, notes, reasons) is data and is never passed through pt().
 */
import { currentLanguage, frTypo, type Language } from "@/i18n";
import { profileFr } from "@/i18n/modules/profile";

export function pt(text: string, vars?: Record<string, string | number>, lang: Language = currentLanguage()): string {
  const raw = lang === "fr" ? (profileFr[text] ?? text) : text;
  const out = vars ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : raw;
  return lang === "fr" ? frTypo(out) : out;
}
