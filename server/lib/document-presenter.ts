/**
 * S17: role-aware presentation of student_documents rows.
 *
 * Students receive an ALLOW-LIST of fields. Anything not named here (admin_notes, student_message (exposed only as review_message),
 * ocr_text, storage_path, url, verified_by, soft_deleted and any column added
 * later) is withheld by default. Staff (admin/staff) keep the full row.
 */
import { isAdminOrStaff } from "./resource-ownership";

type Row = Record<string, any>;

const STUDENT_DOCUMENT_FIELDS = [
  "id",
  "student_id",
  "doc_type",
  "file_name",
  "issuer",
  "doc_date",
  "score",
  "country",
  "notes",
  "visibility",
  "required_for_enrollment",
  "status",
  "verified",
  "verified_at",
  "uploaded_at",
  "created_at",
  "updated_at",
] as const;

/** Statuses where the staff message is addressed to the student. */
const STUDENT_MESSAGE_STATUSES = new Set(["rejected", "resubmit_requested"]);

export function presentDocumentForViewer(
  viewer: { role?: string } | undefined | null,
  doc: Row,
): Row {
  if (isAdminOrStaff(viewer)) return doc;
  const out: Row = {};
  for (const key of STUDENT_DOCUMENT_FIELDS) {
    if (key in doc) out[key] = doc[key];
  }
  // S18: review_message comes ONLY from student_message (written for the student),
  // and only on rejected / resubmit_requested. It NEVER falls back to admin_notes:
  // legacy rows (reviewed before student_message existed) therefore show no message
  // rather than risk leaking an internal staff note.
  out.review_message =
    STUDENT_MESSAGE_STATUSES.has(doc.status) &&
    typeof doc.student_message === "string" &&
    doc.student_message.trim() !== ""
      ? doc.student_message
      : null;
  return out;
}
