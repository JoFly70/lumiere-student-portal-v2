/**
 * S32-A: student-facing document type names in the student's language. The shared map in document-type-labels.ts is
 * English-only (staff views); student screens use the translated `ux.lib.type.*` keys and fall back to it for an
 * unknown type.
 */
import type { TranslationKey } from "@/i18n";
import { docTypeLabel } from "@/lib/document-type-labels";

const TRANSLATED = new Set(["id_gov", "hs_diploma", "hs_transcript", "degree_certificate", "college_transcript", "foreign_eval", "english_cert", "residency_doc", "consent_form", "chat_attachment", "other"]);
const ALIASES: Record<string, string> = { english_proof: "english_cert", residency_proof: "residency_doc" };

export function studentDocTypeLabel(docType: string, t: (key: TranslationKey) => string): string {
  const k = ALIASES[docType] ?? docType;
  return TRANSLATED.has(k) ? t(`ux.lib.type.${k}` as TranslationKey) : docTypeLabel(docType);
}
