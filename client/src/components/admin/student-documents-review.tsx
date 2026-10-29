/**
 * Staff document review (S19): list a student's documents with Verify / Reject / Request resubmission.
 * Reject and resubmit open DocumentReviewDialog, which keeps the student-facing reason and the
 * internal staff note in two separate fields (student_message / admin_notes).
 */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, FileText, RotateCcw, Upload, XCircle } from "lucide-react";
import type { StudentDocument } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { StaffCard, StaffNotice, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";
import { TonePill } from "@/components/admin/control/owner-ui";
import type { Tone } from "@/lib/owner-presentation";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/api";
import { docStatusLabel, docTypeLabel } from "@/lib/document-type-labels";
import { fetchDocumentWithDownloadUrl, useCreateDocument, useGenerateUploadUrl } from "@/hooks/use-documents";
import { useAuth } from "@/lib/auth";
import { DocumentReviewDialog, type DocumentReviewAction, type DocumentReviewPayload } from "./document-review-dialog";
import { canUploadDocumentOnBehalfForRole, STAFF_UPLOAD_ACCEPT, staffUploadMime, validateStaffUploadFile } from "./student-documents-upload-logic";

type ReviewCall = { id: string; action: "verify" | DocumentReviewAction; body: Record<string, unknown> };

/** Calm status tones: pending is the one gold "needs you", verified a quiet green, a returned document attention. */
const statusTone = (s: string): Tone => (s === "verified" ? "ok" : s === "pending" ? "gold" : s === "rejected" || s === "resubmit_requested" ? "attention" : "neutral");

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
  const [fileName, setFileName] = useState<string | null>(null);
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
      <StaffCard as="div" className="space-y-4 bg-student-bg/40 shadow-none" data-testid="staff-upload-on-behalf">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 font-serif text-lg tracking-tight text-student-ink"><Upload className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />Upload on the student's behalf</h3>
          <p className="max-w-3xl text-sm leading-relaxed text-student-muted">The student and staff will see the file. New uploads stay pending review; uploading never verifies a document.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)] xl:items-start">
          <div className="min-w-0 space-y-1.5">
            <label className={cn(staffLabel, "block")} htmlFor="staff-upload-document-type">Document type</label>
            <select id="staff-upload-document-type" className={staffField} value={uploadType} disabled={uploadPending} onChange={(event) => setUploadType(event.target.value)}>
              {STAFF_UPLOAD_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <label className={cn(staffLabel, "block")} htmlFor="staff-upload-document-note">Note <span className="font-normal normal-case tracking-normal">(optional)</span></label>
            <input id="staff-upload-document-note" className={staffField} maxLength={500} value={uploadNote} disabled={uploadPending} placeholder="e.g. Received by email on 12 Oct" onChange={(event) => setUploadNote(event.target.value)} />
          </div>
          <div className="min-w-0 space-y-1.5 md:col-span-2 xl:col-span-1">
            <span className={cn(staffLabel, "block")} id="staff-upload-document-file-label">File</span>
            {/* One control: the native input is visually hidden and driven by the styled button. */}
            <input ref={fileInput} id="staff-upload-document-file" className="sr-only" type="file" accept={STAFF_UPLOAD_ACCEPT} disabled={uploadPending} aria-labelledby="staff-upload-document-file-label" data-testid="input-staff-document-file" onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) { setFileName(file.name); void uploadFile(file); }
            }} />
            <div className="flex min-w-0 items-center gap-3">
              <Button type="button" className={cn(staffBtn.outline, "shrink-0")} variant="outline" disabled={uploadPending} onClick={() => fileInput.current?.click()} data-testid="button-staff-upload-document">
                <Upload className="h-4 w-4" aria-hidden="true" />{uploadPending ? "Uploading…" : "Choose file"}
              </Button>
              <span className={cn("min-w-0 truncate text-sm", fileName ? "text-student-ink" : "text-student-muted")} title={fileName ?? undefined} data-testid="staff-upload-file-name">{fileName ?? "No file chosen"}</span>
            </div>
          </div>
        </div>
        <p className="text-xs text-student-muted">PDF, PNG, JPG or WebP · up to 10 MB. Add the note first: the upload starts as soon as you choose the file.</p>
        {uploadPending ? <div role="status" aria-live="polite" className="space-y-1"><div className="h-1.5 overflow-hidden rounded-full bg-student-line"><div className="h-full w-1/2 animate-pulse rounded-full bg-student-gold" /></div><p className="text-sm text-student-muted">Uploading file securely…</p></div> : null}
        {uploadMessage ? <StaffNotice tone={uploadMessage.kind === "error" ? "urgent" : "success"} role={uploadMessage.kind === "error" ? "alert" : "status"}>{uploadMessage.text}</StaffNotice> : null}
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
  const small = "min-h-9 px-3";
  const quiet = "min-h-9 px-2.5 text-student-muted hover:text-student-ink";

  return (
    <div className="space-y-5" data-testid="documents-review">
      {reviewError && <StaffNotice tone="urgent" role="alert">{reviewError}</StaffNotice>}
      {viewError && <StaffNotice tone="urgent" role="alert">{viewError}</StaffNotice>}
      {documents.length === 0 ? <StaffNotice tone="info" role="status">No documents have been uploaded for this student yet.</StaffNotice> : null}
      {documents.length > 0 ? (
        <ul className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" data-testid="documents-grid">
          {documents.map((d) => {
            const meta = `${docTypeLabel(d.doc_type)}${d.issuer ? ` · ${d.issuer}` : ""}`;
            return (
              <li key={d.id} className="min-w-0">
                <StaffCard as="div" padded={false} className="flex h-full flex-col gap-3 p-4 shadow-none sm:p-5" data-testid={`document-${d.id}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-student-line bg-student-gold-soft/50 text-student-gold-ink"><FileText className="h-4 w-4" /></span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                      <div className="min-w-0 flex-1 basis-[11rem]">
                        <p className="truncate font-medium text-student-ink" title={d.file_name}>{d.file_name}</p>
                        <p className="truncate text-sm text-student-muted" title={meta}>{meta}</p>
                      </div>
                      <TonePill tone={statusTone(d.status)} className="shrink-0" testId={`document-status-${d.id}`}>{docStatusLabel(d.status)}</TonePill>
                    </div>
                  </div>
                  {d.student_message && (d.status === "rejected" || d.status === "resubmit_requested") && (
                    <div className="rounded-lg border border-student-line bg-student-gold-soft/40 px-3 py-2 text-sm leading-relaxed text-student-ink"><p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-student-muted">Shown to student</p><p>{d.student_message}</p></div>
                  )}
                  {d.admin_notes && <div className="rounded-lg border border-dashed border-student-line-strong px-3 py-2 text-sm leading-relaxed text-student-muted"><p className="text-[11px] font-semibold uppercase tracking-[0.1em]">Internal note · staff only</p><p>{d.admin_notes}</p></div>}
                  <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-student-line pt-3">
                    {d.status !== "verified" && (
                      <Button type="button" className={cn(staffBtn.seal, small)} disabled={review.isPending} onClick={() => review.mutate({ id: d.id, action: "verify", body: {} })} data-testid={`button-verify-${d.id}`}><CheckCircle2 className="h-4 w-4" />Verify</Button>
                    )}
                    <Button type="button" className={cn(staffBtn.outline, small)} variant="outline" onClick={() => view(d.id)}><ExternalLink className="h-4 w-4" />View file</Button>
                    {d.status !== "resubmit_requested" && (
                      <Button type="button" className={cn(staffBtn.ghost, quiet)} variant="ghost" disabled={review.isPending} onClick={() => { review.reset(); setDialog({ doc: d, action: "request-resubmit" }); }} data-testid={`button-resubmit-${d.id}`}><RotateCcw className="h-4 w-4" />Request new copy</Button>
                    )}
                    {d.status !== "rejected" && (
                      <Button type="button" className={cn(staffBtn.ghost, quiet)} variant="ghost" disabled={review.isPending} onClick={() => { review.reset(); setDialog({ doc: d, action: "reject" }); }} data-testid={`button-reject-${d.id}`}><XCircle className="h-4 w-4" />Reject</Button>
                    )}
                  </div>
                </StaffCard>
              </li>
            );
          })}
        </ul>
      ) : null}
      <StaffDocumentUpload studentId={studentId} />
      {dialog && (
        <DocumentReviewDialog key={`${dialog.doc.id}-${dialog.action}`} open onOpenChange={(o) => !o && setDialog(null)} action={dialog.action}
          documentLabel={`${docTypeLabel(dialog.doc.doc_type)} · ${dialog.doc.file_name}`} pending={review.isPending} errorMessage={review.error?.message} onSubmit={submit} />
      )}
    </div>
  );
}
