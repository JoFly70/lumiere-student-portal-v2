/**
 * Staff document review (S19): list a student's documents with Verify / Reject / Request resubmission.
 * Reject and resubmit open DocumentReviewDialog, which keeps the student-facing reason and the
 * internal staff note in two separate fields (student_message / admin_notes).
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, RotateCcw, Upload, XCircle } from "lucide-react";
import type { StudentDocument } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StaffCard, StaffNotice, StatusPill, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";
import { apiRequest } from "@/lib/api";
import { docStatusLabel, docTypeLabel } from "@/lib/document-type-labels";
import { fetchDocumentWithDownloadUrl, useCreateDocument, useGenerateUploadUrl } from "@/hooks/use-documents";
import { useAuth } from "@/lib/auth";
import { DocumentReviewDialog, type DocumentReviewAction, type DocumentReviewPayload } from "./document-review-dialog";
import { canUploadDocumentOnBehalfForRole, STAFF_UPLOAD_ACCEPT, staffUploadMime, validateStaffUploadFile } from "./student-documents-upload-logic";

type ReviewCall = { id: string; action: "verify" | DocumentReviewAction; body: Record<string, unknown> };

const statusKey = (s: string) => (s === "verified" ? "official" : s === "pending" ? "submitted" : s === "rejected" || s === "resubmit_requested" ? "attention" : "notstarted") as Parameters<typeof StatusPill>[0]["status"];

const STAFF_UPLOAD_TYPES = [
  ["hs_transcript", "High-school transcript"],
  ["hs_diploma", "High-school diploma"],
  ["college_transcript", "College transcript"],
  ["degree_certificate", "Degree certificate"],
  ["id_gov", "Government-issued ID"],
  ["foreign_eval", "Foreign credential evaluation"],
  ["english_cert", "English proficiency proof"],
  ["residency_doc", "Proof of residency"],
  ["consent_form", "Consent form"],
  ["other", "Other document"],
] as const;

export function StaffDocumentUpload({ studentId }: { studentId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const canUploadOnBehalf = canUploadDocumentOnBehalfForRole(user?.role);
  const generateUploadUrl = useGenerateUploadUrl(studentId);
  const createDocument = useCreateDocument(studentId);
  const [uploadType, setUploadType] = useState<string>("hs_transcript");
  const [uploadMessage, setUploadMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFile = async (file: File) => {
    if (uploading) return;
    setUploadMessage(null);
    const validation = validateStaffUploadFile(file);
    if (!validation.valid) {
      setUploadMessage({ kind: "error", text: validation.message });
      return;
    }
    setUploading(true);
    try {
      const signed = await generateUploadUrl.mutateAsync({
        doc_type: uploadType,
        file_name: file.name,
        file_size: file.size,
        mime_type: staffUploadMime(file) ?? file.type,
      });
      const uploaded = await fetch(signed.upload_url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": staffUploadMime(file) ?? file.type },
      });
      if (!uploaded.ok) throw new Error("The file could not be stored. Please try again.");
      await createDocument.mutateAsync({
        doc_type: uploadType,
        file_name: file.name,
        storage_path: signed.storage_path,
        ...(uploadNote.trim() ? { notes: uploadNote.trim().slice(0, 2000) } : {}),
      });
      setUploadNote("");
      await qc.invalidateQueries({ queryKey: ["documents", studentId] });
      setUploadMessage({ kind: "success", text: "File uploaded. It is pending review and has not been verified." });
    } catch (error) {
      setUploadMessage({ kind: "error", text: error instanceof Error ? error.message : "Upload failed. Please try again." });
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const uploadPending = uploading || generateUploadUrl.isPending || createDocument.isPending;
  if (!canUploadOnBehalf) return null;
  return (
      <StaffCard as="div" className="space-y-3" data-testid="staff-upload-on-behalf">
        <div>
          <h3 className={staffLabel}>Upload on the student's behalf</h3>
          <p className="mt-1 text-sm text-student-muted">The file will be visible to the student and staff (student_staff). New uploads remain pending review; uploading does not verify a document.</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
          <div>
            <label className={staffLabel} htmlFor="staff-upload-document-type">Document type</label>
            <select id="staff-upload-document-type" className={`${staffField} mt-1 w-full`} value={uploadType} disabled={uploadPending} onChange={(event) => setUploadType(event.target.value)}>
              {STAFF_UPLOAD_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className={staffLabel} htmlFor="staff-upload-document-file">File</label>
            <Input ref={fileInput} id="staff-upload-document-file" className={`${staffField} mt-1`} type="file" accept={STAFF_UPLOAD_ACCEPT} disabled={uploadPending} data-testid="input-staff-document-file" onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void uploadFile(file);
            }} />
            <p className="mt-1 text-xs text-student-muted">PDF, PNG, JPG or WebP · up to 10 MB</p>
          </div>
          <Button type="button" className={staffBtn.outline} variant="outline" disabled={uploadPending} onClick={() => fileInput.current?.click()} data-testid="button-staff-upload-document">
            <Upload className="h-4 w-4" aria-hidden="true" />{uploadPending ? "Uploading…" : "Choose file"}
          </Button>
        </div>
        <div>
          <label className={staffLabel} htmlFor="staff-upload-document-note">Note (optional, add before choosing the file)</label>
          <input id="staff-upload-document-note" className={`${staffField} mt-1 w-full`} maxLength={500} value={uploadNote} disabled={uploadPending} placeholder="e.g. Received by email on 12 Oct" onChange={(event) => setUploadNote(event.target.value)} />
        </div>
        {uploadPending ? <div role="status" aria-live="polite" className="space-y-1"><div className="h-1.5 overflow-hidden rounded-full bg-student-line"><div className="h-full w-1/2 animate-pulse rounded-full bg-student-gold" /></div><p className="text-sm text-student-muted">Uploading file securely…</p></div> : null}
        {uploadMessage ? <StaffNotice tone={uploadMessage.kind === "error" ? "urgent" : "gold"} role={uploadMessage.kind === "error" ? "alert" : "status"}>{uploadMessage.text}</StaffNotice> : null}
      </StaffCard>
  );
}

export function StudentDocumentsReview({ studentId, documents }: { studentId: string; documents: readonly StudentDocument[] }) {
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<{ doc: StudentDocument; action: DocumentReviewAction } | null>(null);
  const [viewError, setViewError] = useState<string | null>(null);
  const review = useMutation<unknown, Error, ReviewCall>({
    mutationFn: ({ id, action, body }) => apiRequest(`/api/documents/${encodeURIComponent(id)}/${action}`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["documents", studentId] }),
  });
  const submit = (payload: DocumentReviewPayload) => {
    if (!dialog) return;
    review.mutate({ id: dialog.doc.id, action: dialog.action, body: { ...payload } }, { onSuccess: () => setDialog(null) });
  };
  const view = (id: string) => {
    setViewError(null);
    fetchDocumentWithDownloadUrl(id).then((d) => window.open(d.download_url, "_blank", "noopener,noreferrer")).catch(() => setViewError("The file could not be opened."));
  };
  const reviewError = review.error && !dialog ? (typeof review.error.message === "string" ? review.error.message : "Review failed") : null;

  return (
    <div className="space-y-3" data-testid="documents-review">
      {reviewError && <StaffNotice tone="urgent" role="alert">{reviewError}</StaffNotice>}
      {viewError && <StaffNotice tone="urgent" role="alert">{viewError}</StaffNotice>}
      <StaffDocumentUpload studentId={studentId} />
      {documents.length === 0 ? <StaffNotice tone="gold" role="status">No documents have been uploaded for this student yet.</StaffNotice> : null}
      <ul className="grid gap-3 md:grid-cols-2">
        {documents.map((d) => (
          <li key={d.id}>
            <StaffCard as="div" className="space-y-3" data-testid={`document-${d.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="min-w-0 break-words font-medium text-student-ink">{d.file_name}</p>
                <StatusPill status={statusKey(d.status)} label={docStatusLabel(d.status)} />
              </div>
              <p className="text-sm text-student-muted">{docTypeLabel(d.doc_type)}{d.issuer ? ` · ${d.issuer}` : ""}</p>
              {d.student_message && (d.status === "rejected" || d.status === "resubmit_requested") && (
                <p className="rounded-lg border border-student-line bg-student-gold-soft/40 px-3 py-2 text-sm"><span className="font-medium">Shown to student:</span> {d.student_message}</p>
              )}
              {d.admin_notes && <p className="rounded-lg border border-dashed border-student-line-strong px-3 py-2 text-sm text-student-muted"><span className="font-medium">Internal note (staff only):</span> {d.admin_notes}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" className={staffBtn.outline} variant="outline" onClick={() => view(d.id)}><ExternalLink className="h-4 w-4" />View file</Button>
                {d.status !== "verified" && (
                  <Button type="button" className={staffBtn.seal} disabled={review.isPending} onClick={() => review.mutate({ id: d.id, action: "verify", body: {} })} data-testid={`button-verify-${d.id}`}><CheckCircle2 className="h-4 w-4" />Verify</Button>
                )}
                {d.status !== "resubmit_requested" && (
                  <Button type="button" className={staffBtn.outline} variant="outline" disabled={review.isPending} onClick={() => { review.reset(); setDialog({ doc: d, action: "request-resubmit" }); }} data-testid={`button-resubmit-${d.id}`}><RotateCcw className="h-4 w-4" />Request resubmission</Button>
                )}
                {d.status !== "rejected" && (
                  <Button type="button" className={staffBtn.outline} variant="outline" disabled={review.isPending} onClick={() => { review.reset(); setDialog({ doc: d, action: "reject" }); }} data-testid={`button-reject-${d.id}`}><XCircle className="h-4 w-4" />Reject</Button>
                )}
              </div>
            </StaffCard>
          </li>
        ))}
      </ul>
      {dialog && (
        <DocumentReviewDialog key={`${dialog.doc.id}-${dialog.action}`} open onOpenChange={(o) => !o && setDialog(null)} action={dialog.action}
          documentLabel={`${docTypeLabel(dialog.doc.doc_type)} · ${dialog.doc.file_name}`} pending={review.isPending} errorMessage={review.error?.message} onSubmit={submit} />
      )}
    </div>
  );
}
