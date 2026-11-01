import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n";

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
  open, onOpenChange, action, documentLabel, pending = false, errorMessage, onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: DocumentReviewAction;
  documentLabel: string;
  pending?: boolean;
  errorMessage?: string;
  onSubmit: (payload: DocumentReviewPayload) => void;
}) {
  const { t } = useT();
  const [studentMessage, setStudentMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const payload = buildDocumentReviewPayload(studentMessage, internalNote);
  const title = action === "reject" ? t("s32ws.dlg.reject") : t("s32ws.dlg.resubmit");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-document-review">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{documentLabel}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="doc-review-student-message">{t("s32ws.dlg.reason")}</Label>
            <Textarea
              id="doc-review-student-message"
              value={studentMessage}
              maxLength={1000}
              required
              onChange={(e) => setStudentMessage(e.target.value)}
              placeholder={t("s32ws.dlg.reasonPlaceholder")}
              data-testid="input-student-message"
            />
            <p className="text-xs text-muted-foreground">{t("s32ws.dlg.reasonHelp")}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-review-internal-note">{t("s32ws.dlg.internal")}</Label>
            <Textarea
              id="doc-review-internal-note"
              value={internalNote}
              maxLength={2000}
              onChange={(e) => setInternalNote(e.target.value)}
              placeholder={t("s32ws.dlg.internalPlaceholder")}
              data-testid="input-internal-note"
            />
            <p className="text-xs text-muted-foreground">{t("s32ws.dlg.internalHelp")}</p>
          </div>
        </div>
        {errorMessage ? <p role="alert" className="text-sm text-st-urgent" data-testid="text-review-error">{errorMessage}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t("s32ws.dlg.cancel")}</Button>
          <Button type="button" disabled={!payload || pending} onClick={() => payload && onSubmit(payload)} data-testid="button-submit-document-review">
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
