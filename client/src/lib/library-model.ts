/**
 * Academic library model (pure). The library organises what the portal already holds for the student:
 * their plan (course guides, tasks as a study checklist) and their own documents (GET /api/documents/student/:id).
 * It is NOT the school's learning platform: graded coursework stays there.
 *
 * Course links: a document is linked to a course shelf when its notes carry the marker `[course:<courseKey>]`
 * (written by the library upload). Versions: documents of the same type (and course / name for "other"), newest first.
 */
import type { StudentDocument } from "@shared/schema";

export type LibCategory = "coursework" | "academic" | "language" | "identity" | "contracts" | "other";
export const LIB_CATEGORIES: readonly LibCategory[] = ["coursework", "academic", "language", "identity", "contracts", "other"];

/** doc_type written when a student uploads into a category (the server enum has no coursework type). */
export const UPLOAD_DOC_TYPE: Readonly<Record<Exclude<LibCategory, "contracts" | "other">, string>> = {
  coursework: "other",
  academic: "hs_transcript",
  language: "english_cert",
  identity: "id_gov",
};
export const UPLOAD_CATEGORIES = Object.keys(UPLOAD_DOC_TYPE) as (keyof typeof UPLOAD_DOC_TYPE)[];

const COURSE_MARKER = /\[course:([a-z0-9][a-z0-9_-]*)\]/i;

export function linkedCourseKey(doc: Pick<StudentDocument, "notes">): string | null {
  const m = COURSE_MARKER.exec(doc.notes ?? "");
  return m ? m[1]! : null;
}

export function buildDocumentNotes(courseKey: string | null, note?: string): string | null {
  const parts = [courseKey ? `[course:${courseKey}]` : "", (note ?? "").trim()].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** Notes without the machine marker, for display. */
export function visibleNotes(doc: Pick<StudentDocument, "notes">): string {
  return (doc.notes ?? "").replace(COURSE_MARKER, "").trim();
}

export function categoryOfDoc(doc: Pick<StudentDocument, "doc_type" | "notes">): LibCategory {
  if (linkedCourseKey(doc)) return "coursework";
  switch (doc.doc_type) {
    case "hs_transcript": case "hs_diploma": case "degree_certificate": case "college_transcript": case "foreign_eval": return "academic";
    case "english_cert": return "language";
    case "id_gov": case "residency_doc": return "identity";
    case "consent_form": return "contracts";
    case "other": return "coursework";
    default: return "other";
  }
}

export type Provenance = "you" | "lumiere";
/** Documents Lumière placed on the file carry the issuer "Lumière"; everything else was uploaded by the student. */
export function provenanceOf(doc: Pick<StudentDocument, "issuer">): Provenance {
  return /lumi[eè]re/i.test(doc.issuer ?? "") ? "lumiere" : "you";
}

export interface DocGroup {
  readonly id: string;
  readonly category: LibCategory;
  readonly courseKey: string | null;
  /** Newest first; versions[0] is the latest. */
  readonly versions: readonly StudentDocument[];
}

const stem = (name: string) => name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[\s_-]*(v|version)?[\s_-]*\d+$/i, "").replace(/\s*\(\d+\)$/, "").trim();
const when = (d: StudentDocument) => d.created_at || d.uploaded_at || "";

export function groupVersions(docs: readonly StudentDocument[]): DocGroup[] {
  const map = new Map<string, StudentDocument[]>();
  for (const d of docs) {
    if (d.soft_deleted) continue;
    const course = linkedCourseKey(d);
    const key = [d.doc_type, course ?? "", d.doc_type === "other" || course ? stem(d.file_name) : ""].join("|");
    (map.get(key) ?? map.set(key, []).get(key)!).push(d);
  }
  return [...map.entries()]
    .map(([id, list]) => {
      const versions = [...list].sort((a, b) => when(b).localeCompare(when(a)));
      return { id, category: categoryOfDoc(versions[0]!), courseKey: linkedCourseKey(versions[0]!), versions };
    })
    .sort((a, b) => when(b.versions[0]!).localeCompare(when(a.versions[0]!)));
}

export type DocAttention = "ok" | "pending" | "action";
export function attentionOfDoc(doc: Pick<StudentDocument, "status">): DocAttention {
  if (doc.status === "rejected" || doc.status === "resubmit_requested") return "action";
  return doc.status === "pending" ? "pending" : "ok";
}

export interface SearchableCourse { readonly key: string; readonly title: string; readonly tasks: readonly { title: string }[] }

/** Case- and accent-insensitive "all words" match over the given haystack strings. */
export function matchesQuery(haystack: readonly (string | null | undefined)[], query: string): boolean {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = norm(haystack.filter(Boolean).join(" "));
  return words.every((w) => text.includes(w));
}

export function docMatches(group: DocGroup, query: string, courseTitle?: string | null): boolean {
  const latest = group.versions[0]!;
  return matchesQuery([...group.versions.map((v) => v.file_name), visibleNotes(latest), latest.issuer, latest.doc_type.replace(/_/g, " "), courseTitle], query);
}

export function courseMatches(course: SearchableCourse, query: string): boolean {
  return matchesQuery([course.title, ...course.tasks.map((t) => t.title)], query);
}
