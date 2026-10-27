/**
 * Staff document review (S19): list a student's documents with Verify / Reject / Request resubmission.
 * Reject and resubmit open DocumentReviewDialog, which keeps the student-facing reason and the
 * internal staff note in two separate fields (student_message / admin_notes).
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, RotateCcw, XCircle } from "lucide-react";
import type { StudentDocument } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { StaffCard, StaffNotice, StatusPill, staffBtn } from "@/components/staff/staff-ui";
import { apiRequest } from "@/lib/api";
import { docStatusLabel, docTypeLabel } from "@/lib/document-type-labels";
import { fetchDocumentWithDownloadUrl } from "@/hooks/use-documents";
import { DocumentReviewDialog, type DocumentReviewAction, type DocumentReviewPayload } from "./document-review-dialog";

type ReviewCall = { id: string; action: "verify" | DocumentReviewAction; body: Record<string, unknown> };

const statusKey = (s: string) => (s === "verified" ? "official" : s === "pending" ? "submitted" : s === "rejected" || s === "resubmit_requested" ? "attention" : "notstarted") as Parameters<typeof StatusPill>[0]["status"];

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
