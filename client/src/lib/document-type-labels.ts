/**
 * Human names for the stored document type codes and statuses. One map for the
 * student Documents page and the staff workspace, so neither shows raw codes.
 */
const DOC_TYPE_LABELS: Record<string, string> = {
  hs_transcript: "High-school transcript",
  hs_diploma: "High-school diploma",
  id_gov: "Government-issued ID",
  college_transcript: "College transcript",
  foreign_eval: "Foreign credential evaluation",
  degree_certificate: "Degree certificate",
  english_cert: "English proficiency proof",
  english_proof: "English proficiency proof",
  residency_doc: "Proof of residency",
  residency_proof: "Proof of residency",
  consent_form: "Consent form",
  other: "Other document",
  chat_attachment: "Chat attachment",
};

/** "some_snake_case" or "SOME_ENUM" to "Some snake case". */
export function humanizeToken(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : raw;
}

export function docTypeLabel(docType: string): string {
  return DOC_TYPE_LABELS[docType] ?? humanizeToken(docType);
}

const DOC_STATUS_LABELS: Record<string, string> = {
  pending: "Pending review",
  verified: "Verified",
  rejected: "Rejected",
  resubmit_requested: "Resubmission requested",
  not_submitted: "Not submitted",
};

export function docStatusLabel(status: string): string {
  return DOC_STATUS_LABELS[status] ?? humanizeToken(status);
}
