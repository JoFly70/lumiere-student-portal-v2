/**
 * S32-A (services): pure helpers shared by the student Documents and Library pages.
 * No React, no network: unit-tested in tests/s32a-services-docs.test.ts.
 */

export type UploadTab = "all" | "academic" | "financial" | "identity" | "foreign_credentials" | "transfer_credits" | "chat";
export const DOCUMENT_TABS: readonly UploadTab[] = ["all", "academic", "financial", "identity", "foreign_credentials", "transfer_credits", "chat"];

/** Doc types a student may pick when the tab does not tell us what the file is. All are accepted by docTypeEnum on the server. */
export const ALL_TAB_DOC_TYPES = ["other", "id_gov", "hs_transcript", "hs_diploma", "college_transcript", "degree_certificate", "foreign_eval", "english_cert", "residency_doc"] as const;
export const ACADEMIC_TAB_DOC_TYPES = ["hs_transcript", "hs_diploma", "college_transcript", "degree_certificate", "english_cert", "other"] as const;

const FIXED_TAB_DOC_TYPE: Record<Exclude<UploadTab, "all" | "academic">, string> = {
  financial: "other",
  identity: "id_gov",
  foreign_credentials: "foreign_eval",
  transfer_credits: "college_transcript",
  chat: "other",
};

/** The type picker offered for a tab, or null when the tab already fixes the type. */
export function uploadTypeOptions(tab: UploadTab): readonly string[] | null {
  if (tab === "all") return ALL_TAB_DOC_TYPES;
  if (tab === "academic") return ACADEMIC_TAB_DOC_TYPES;
  return null;
}

/** What to file an upload as when the student has not chosen: never a high-school transcript unless the program is high school. */
export function defaultUploadDocType(tab: UploadTab, hasHighSchool: boolean): string {
  if (tab === "academic") return hasHighSchool ? "hs_transcript" : "other";
  if (tab === "all") return "other";
  return FIXED_TAB_DOC_TYPE[tab];
}

/**
 * doc_type for an upload. A replacement keeps the replaced document's type (`override`); otherwise a valid student choice
 * wins; otherwise the safe default. The "All" tab never auto-files as a high-school transcript (F10).
 */
export function resolveUploadDocType(input: { tab: UploadTab; selected?: string | null; override?: string | null; hasHighSchool: boolean }): string {
  if (input.override) return input.override;
  const options = uploadTypeOptions(input.tab);
  if (options && input.selected && options.includes(input.selected)) return input.selected;
  return defaultUploadDocType(input.tab, input.hasHighSchool);
}

/** `?tab=financial` on /documents; unknown values are ignored. */
export function documentsTabFromSearch(search: string): UploadTab {
  try {
    const v = new URLSearchParams(search).get("tab");
    return v && (DOCUMENT_TABS as readonly string[]).includes(v) ? (v as UploadTab) : "all";
  } catch {
    return "all";
  }
}

/**
 * The staff reason shown to the student. The server presenter exposes it as `review_message` (student_message is stripped);
 * `student_message` is read only as a fallback for older shapes. Only for rejected / resubmit-requested documents.
 */
export function reviewMessageOf(doc: { status: string; review_message?: string | null; student_message?: string | null }): string | null {
  if (doc.status !== "rejected" && doc.status !== "resubmit_requested") return null;
  const raw = doc.review_message ?? doc.student_message ?? null;
  return typeof raw === "string" && raw.trim() !== "" ? raw : null;
}
