import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuthFetch } from "@/lib/auth";
import {
  classifyPlacementWorkflowError,
  createPlacementBody,
  placementActionCopy,
  placementDialogLocked,
  placementEndpoint,
  placementMutationOutcome,
  placementSuccessMessage,
  revokePlacementBody,
  supersedePlacementBody,
  type CanonicalLabelOption,
  type PlacementOperation,
  type PlacementWorkflowError,
} from "@/pages/controlled-placement-workflow";

const NO_RULE = "__no_academic_rule__";

class PlacementRequestError extends Error {
  constructor(readonly workflowError: PlacementWorkflowError) {
    super(workflowError.message);
  }
}

export interface PlacementActionFeedback {
  readonly kind: "success" | "error";
  readonly message: string;
}

export interface PlacementActionDialogProps {
  readonly operation: PlacementOperation;
  readonly studentId: string;
  readonly studentName: string;
  readonly snapshotFingerprint: string;
  readonly decisionId?: string;
  readonly placementId?: string;
  readonly placementLabel?: string;
  readonly placementStatus?: string;
  readonly currentRationale?: string;
  readonly requirements: readonly CanonicalLabelOption[];
  readonly academicRules: readonly CanonicalLabelOption[];
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onRefreshCanonical: () => Promise<boolean>;
  readonly onSnapshotUnavailable: () => void;
  readonly onFeedback: (feedback: PlacementActionFeedback) => void;
}

export function PlacementActionDialog({
  operation,
  studentId,
  studentName,
  snapshotFingerprint,
  decisionId,
  placementId,
  placementLabel,
  placementStatus,
  currentRationale,
  requirements,
  academicRules,
  disabled = false,
  disabledReason,
  onRefreshCanonical,
  onSnapshotUnavailable,
  onFeedback,
}: PlacementActionDialogProps) {
  const authFetch = useAuthFetch();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [requirementId, setRequirementId] = useState("");
  const [academicRuleId, setAcademicRuleId] = useState(NO_RULE);
  const [rationale, setRationale] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [staleDraft, setStaleDraft] = useState(false);
  const [dialogFeedback, setDialogFeedback] = useState<PlacementActionFeedback | null>(null);

  const needsPlacementFields = operation !== "revoke";
  const optionsUnavailable = needsPlacementFields && requirements.length === 0;
  const locallyDisabled = disabled || optionsUnavailable;
  const lockReason = optionsUnavailable
    ? "No named degree requirements are available for placement."
    : disabledReason ?? "Placement changes are temporarily unavailable while the student workspace refreshes.";

  const reset = () => {
    setRequirementId("");
    setAcademicRuleId(NO_RULE);
    setRationale("");
    setConfirmed(false);
    setStaleDraft(false);
    setDialogFeedback(null);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const endpoint = placementEndpoint(studentId, operation, placementId);
      const trimmedRationale = rationale.trim();
      const body = operation === "create"
        ? createPlacementBody({
            expectedSnapshotFingerprint: snapshotFingerprint,
            studentCreditDecisionId: decisionId!,
            requirementId,
            academicRuleId: academicRuleId === NO_RULE ? null : academicRuleId,
            rationale: trimmedRationale,
          })
        : operation === "supersede"
          ? supersedePlacementBody({
              expectedSnapshotFingerprint: snapshotFingerprint,
              requirementId,
              academicRuleId: academicRuleId === NO_RULE ? null : academicRuleId,
              rationale: trimmedRationale,
            })
          : revokePlacementBody({
              expectedSnapshotFingerprint: snapshotFingerprint,
              rationale: trimmedRationale,
            });
      const response = await authFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PlacementRequestError({
          kind: "unexpected",
          message: "The placement request returned an invalid response. No changes were applied.",
        });
      }
      if (!response.ok) {
        throw new PlacementRequestError(
          classifyPlacementWorkflowError(response.status, payload),
        );
      }
      if (!payload || typeof payload !== "object") {
        throw new PlacementRequestError({
          kind: "unexpected",
          message: "The placement request returned an invalid response. No changes were applied.",
        });
      }
      return payload;
    },
    onSuccess: async () => {
      const refreshed = await onRefreshCanonical();
      const feedback: PlacementActionFeedback = {
        kind: refreshed ? "success" : "error",
        message: placementSuccessMessage(operation, refreshed),
      };
      if (!refreshed) onSnapshotUnavailable();
      onFeedback(feedback);
      setOpen(false);
      reset();
    },
    onError: async (error) => {
      const workflowError = error instanceof PlacementRequestError
        ? error.workflowError
        : {
            kind: "unexpected" as const,
            message: "The placement request could not be completed. No changes were applied.",
          };
      const outcome = placementMutationOutcome(workflowError.kind);
      if (workflowError.kind === "snapshot-unavailable") {
        onSnapshotUnavailable();
      }
      if (workflowError.kind === "stale") {
        setStaleDraft(true);
        setConfirmed(false);
      }
      const refreshed = outcome.refetchCanonicalWorkspace
        ? await onRefreshCanonical()
        : false;
      const message = workflowError.kind === "stale"
        ? refreshed
          ? "The student record changed. The workspace was refreshed. Your draft is preserved below for reference; close this dialog and review the updated placement before trying again."
          : "The student record changed, but the workspace could not be refreshed. Your draft is preserved below for reference. Close this dialog and refresh the workspace before trying again."
        : workflowError.message;
      const feedback: PlacementActionFeedback = { kind: "error", message };
      setDialogFeedback(feedback);
      onFeedback(feedback);
    },
  });

  const locked = placementDialogLocked(locallyDisabled, mutation.isPending, staleDraft);
  const formComplete = (!needsPlacementFields || requirementId.length > 0)
    && rationale.trim().length > 0
    && confirmed;
  const actionCopy = placementActionCopy(operation);
  const triggerLabel = actionCopy.trigger;
  const confirmLabel = actionCopy.confirm;
  const dialogTitle = operation === "create"
    ? `Add a placement for ${studentName}`
    : operation === "supersede"
      ? `Replace ${placementLabel ?? "this placement"}`
      : `Revoke ${placementLabel ?? "this placement"}`;
  const requirementIdValue = requirements.find((option) => option.id === requirementId);
  const requirementSelectId = `${fieldId}-requirement`;
  const ruleSelectId = `${fieldId}-academic-rule`;
  const rationaleId = `${fieldId}-rationale`;
  const confirmationId = `${fieldId}-confirm`;
  const dialogLockMessageId = `${fieldId}-dialog-lock-message`;
  const triggerLockMessageId = `${fieldId}-trigger-lock-message`;

  return <div className="space-y-2">
    <Dialog open={open} onOpenChange={(next) => {
      if (mutation.isPending) return;
      setOpen(next);
      if (!next) reset();
    }}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={operation === "revoke" ? "destructive" : "outline"}
          disabled={locallyDisabled}
          aria-describedby={locallyDisabled ? triggerLockMessageId : undefined}
        >
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent aria-busy={mutation.isPending}>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {operation === "create"
              ? "Apply the accepted credit decision to a named degree requirement."
              : operation === "supersede"
                ? "Choose a new requirement for this placement. The previous record will remain in its history."
                : "Remove this active placement. The record and its history will remain visible."}
          </DialogDescription>
        </DialogHeader>

        <dl className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2">
          <div><dt className="text-xs font-medium text-muted-foreground">Student</dt><dd>{studentName}</dd></div>
          {operation !== "create" && <>
            <div><dt className="text-xs font-medium text-muted-foreground">Current requirement</dt><dd>{placementLabel ?? "Not provided"}</dd></div>
            <div><dt className="text-xs font-medium text-muted-foreground">Current status</dt><dd>{placementStatus ?? "Not provided"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs font-medium text-muted-foreground">Current rationale</dt><dd>{currentRationale ?? "Not provided"}</dd></div>
          </>}
        </dl>

        {(locallyDisabled || staleDraft) && <div id={dialogLockMessageId} role="status" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-900 dark:text-amber-200">
          <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{staleDraft ? "This draft is read-only because the student record changed." : lockReason}</span>
        </div>}

        {dialogFeedback && <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{dialogFeedback.message}</span>
        </div>}

        <div className="space-y-4">
          {needsPlacementFields && <>
            <div className="space-y-2">
              <Label htmlFor={requirementSelectId}>New requirement</Label>
              <Select value={requirementId} onValueChange={setRequirementId} disabled={locked}>
                <SelectTrigger id={requirementSelectId}>
                  <SelectValue placeholder="Select a degree requirement" />
                </SelectTrigger>
                <SelectContent>
                  {requirements.map((option) =>
                    <SelectItem key={option.id} value={option.id}>
                      <span>{option.label}</span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{option.id}</span>
                    </SelectItem>)}
                </SelectContent>
              </Select>
              {requirementIdValue && <p className="text-xs text-muted-foreground">Selected: {requirementIdValue.label}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor={ruleSelectId}>Academic rule (optional)</Label>
              <Select value={academicRuleId} onValueChange={setAcademicRuleId} disabled={locked}>
                <SelectTrigger id={ruleSelectId}>
                  <SelectValue placeholder="No academic rule" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_RULE}>No academic rule</SelectItem>
                  {academicRules.map((option) =>
                    <SelectItem key={option.id} value={option.id}>
                      <span>{option.label}</span>
                      <span className="ml-2 font-mono text-[10px] text-muted-foreground">{option.id}</span>
                    </SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>}
          <div className="space-y-2">
            <Label htmlFor={rationaleId}>{operation === "create" ? "Rationale" : "Rationale for this change"}</Label>
            <Textarea
              id={rationaleId}
              value={rationale}
              onChange={(event) => setRationale(event.target.value)}
              placeholder="Explain why this placement change is needed"
              disabled={locked}
              readOnly={staleDraft}
            />
          </div>
          <div className="flex items-start gap-3 rounded-md border p-3">
            <Checkbox
              id={confirmationId}
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              disabled={locked}
            />
            <Label htmlFor={confirmationId} className="text-sm font-normal leading-5">
              I reviewed the student and placement details above and intend to {operation === "create" ? "add this placement" : operation === "supersede" ? "replace this placement" : "revoke this placement"}.
            </Label>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
            {staleDraft ? "Close and review workspace" : "Cancel"}
          </Button>
          <Button
            type="button"
            variant={operation === "revoke" ? "destructive" : "default"}
            disabled={!formComplete || locked}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {locallyDisabled && <p id={triggerLockMessageId} className="max-w-xs text-xs text-muted-foreground">
      {lockReason}
    </p>}
  </div>;
}