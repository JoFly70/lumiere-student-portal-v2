import { frTypo, type Language } from "@/i18n";
import { assistantEn, assistantFr, type AssistantKey } from "@/i18n/modules/assistant";
import { studentOsEn, studentOsFr, type StudentOsKey } from "@/i18n/modules/student-os";

export type AssistantTrKey = AssistantKey | StudentOsKey;
export type Tr = (key: AssistantTrKey, vars?: Record<string, string | number>) => string;

const EN: Record<string, string> = { ...assistantEn, ...studentOsEn };
const FR: Record<string, string> = { ...assistantFr, ...studentOsFr };

/** Self-contained lookup: works whether or not the modules have been spread into the global dictionaries yet. */
export function makeTr(language: Language): Tr {
  const dict = language === "fr" ? FR : EN;
  return (key, vars) => {
    let s = dict[key] ?? EN[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return language === "fr" ? frTypo(s) : s;
  };
}
