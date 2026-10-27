import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export type DocumentReviewAction = "reject" | "request-resubmit";

export interface DocumentReviewPayload {
  student_message: string;
  admin_notes?: string;
}

/** Builds the request body for POST /api/documents/:id/{reject|request-resubmit}. Pure, so it is unit-testable. */
export function buildDocumentReviewPayload(studentMessage: string, internalNote: string): DocumentReviewPayload | null {
  const student_message = studentMessage.trim();
  if (!student_message) return null;
  const note = internalNote.trim();
  return note ? { student_message, admin_notes: note } : { student_message };
}

/**
 * S18 staff review dialog for rejecting / requesting resubmission of a document.
 * Two clearly separated fields: the reason the STUDENT sees, and an INTERNAL staff-only note.
 * Wire `onSubmit` to POST /api/documents/:id/reject or /request-resubmit with the payload.
 */
export function DocumentReviewDialog({
  open, onOpenChange, action, documentLabel, pending = false, onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: DocumentReviewAction;
  documentLabel: string;
  pending?: boolean;
  onSubmit: (payload: DocumentReviewPayload) => void;
}) {
  const [studentMessage, setStudentMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const payload = buildDocumentReviewPayload(studentMessage, internalNote);
  const title = action === "reject" ? "Reject document" : "Request a new upload";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-document-review">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{documentLabel}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-review-student-message">Reason shown to student</Label>
            <Textarea
              id="doc-review-student-message"
              value={studentMessage}
              maxLength={1000}
              required
              onChange={(e) => setStudentMessage(e.target.value)}
              placeholder="Explain what the student should fix, in plain words."
              data-testid="input-student-message"
            />
            <p className="text-xs text-muted-foreground">The student will see this text. Required.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-review-internal-note">Internal note (staff only)</Label>
            <Textarea
              id="doc-review-internal-note"
              value={internalNote}
              maxLength={2000}
              onChange={(e) => setInternalNote(e.target.value)}
              placeholder="Optional. Never shown to the student."
              data-testid="input-internal-note"
            />
            <p className="text-xs text-muted-foreground">Visible to staff only. Optional.</p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!payload || pending} onClick={() => payload && onSubmit(payload)} data-testid="button-submit-document-review">
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
