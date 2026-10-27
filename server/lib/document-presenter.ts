/**
 * S17: role-aware presentation of student_documents rows.
 *
 * Students receive an ALLOW-LIST of fields. Anything not named here (admin_notes,
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
  // The reason on a rejection / resubmit request is written for the student.
  // Notes on any other status stay internal.
  out.review_message =
    STUDENT_MESSAGE_STATUSES.has(doc.status) && typeof doc.admin_notes === "string"
      ? doc.admin_notes
      : null;
  return out;
}
