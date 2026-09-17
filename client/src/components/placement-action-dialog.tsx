import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { useToast } from "@/hooks/use-toast";
import { useAuthFetch } from "@/lib/auth";
import {
  classifyPlacementWorkflowError,
  createPlacementBody,
  placementEndpoint,
  placementMutationOutcome,
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

export interface PlacementActionDialogProps {
  readonly operation: PlacementOperation;
  readonly studentId: string;
  readonly snapshotFingerprint: string;
  readonly decisionId?: string;
  readonly placementId?: string;
  readonly requirements: readonly CanonicalLabelOption[];
  readonly academicRules: readonly CanonicalLabelOption[];
  readonly disabled?: boolean;
  readonly onRefreshCanonical: () => Promise<boolean>;
  readonly onSnapshotUnavailable: () => void;
}

export function PlacementActionDialog({
  operation,
  studentId,
  snapshotFingerprint,
  decisionId,
  placementId,
  requirements,
  academicRules,
  disabled = false,
  onRefreshCanonical,
  onSnapshotUnavailable,
}: PlacementActionDialogProps) {
  const authFetch = useAuthFetch();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [requirementId, setRequirementId] = useState("");
  const [academicRuleId, setAcademicRuleId] = useState(NO_RULE);
  const [rationale, setRationale] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  const reset = () => {
    setRequirementId("");
    setAcademicRuleId(NO_RULE);
    setRationale("");
    setConfirmed(false);
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
      const outcome = placementMutationOutcome("success");
      if (outcome.resetDialog) {
        setOpen(false);
        reset();
      }
      if (outcome.refetchCanonicalWorkspace) await onRefreshCanonical();
      toast({
        title: operation === "create"
          ? "Placement recorded"
          : operation === "supersede"
            ? "Placement superseded"
            : "Placement revoked",
        description: "The canonical workspace has been refreshed.",
      });
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
      if (outcome.resetDialog) {
        setOpen(false);
        reset();
      }
      if (outcome.refetchCanonicalWorkspace) await onRefreshCanonical();
      toast({
        title: workflowError.kind === "stale"
          ? "Workspace refreshed—review required"
          : "Placement update failed",
        description: workflowError.message,
        variant: "destructive",
      });
    },
  });

  const needsPlacementFields = operation !== "revoke";
  const formComplete = (!needsPlacementFields || requirementId.length > 0)
    && rationale.trim().length > 0
    && confirmed;
  const triggerLabel = operation === "create"
    ? "Add placement"
    : operation === "supersede"
      ? "Supersede"
      : "Revoke";
  const confirmLabel = operation === "create"
    ? "Confirm placement"
    : operation === "supersede"
      ? "Confirm supersession"
      : "Confirm revocation";

  return <Dialog open={open} onOpenChange={(next) => {
    if (mutation.isPending) return;
    setOpen(next);
    if (!next) reset();
  }}>
    <DialogTrigger asChild>
      <Button
        type="button"
        size="sm"
        variant={operation === "revoke" ? "destructive" : "outline"}
        disabled={disabled}
      >
        {triggerLabel}
      </Button>
    </DialogTrigger>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{triggerLabel}</DialogTitle>
        <DialogDescription>
          {operation === "create"
            ? "Record an operator-selected requirement placement for the latest accepted decision."
            : operation === "supersede"
              ? "Replace this active placement while retaining its server-controlled decision and assignment identity."
              : "Revoke this active placement. Its lifecycle and provenance history will remain visible."}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {needsPlacementFields && <>
          <div className="space-y-2">
            <Label>Requirement</Label>
            <Select value={requirementId} onValueChange={setRequirementId}>
              <SelectTrigger><SelectValue placeholder="Select a canonical requirement" /></SelectTrigger>
              <SelectContent>
                {requirements.map((option) =>
                  <SelectItem key={option.id} value={option.id}>
                    <span>{option.label}</span>
                    <span className="ml-2 font-mono text-[10px] text-muted-foreground">{option.id}</span>
                  </SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Academic rule (optional)</Label>
            <Select value={academicRuleId} onValueChange={setAcademicRuleId}>
              <SelectTrigger><SelectValue placeholder="No academic rule" /></SelectTrigger>
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
          <Label htmlFor={`${operation}-${placementId ?? decisionId}-rationale`}>Rationale</Label>
          <Textarea
            id={`${operation}-${placementId ?? decisionId}-rationale`}
            value={rationale}
            onChange={(event) => setRationale(event.target.value)}
            placeholder="Explain the operator-controlled placement change"
            disabled={mutation.isPending}
          />
        </div>
        <div className="flex items-start gap-3 rounded-md border p-3">
          <Checkbox
            id={`${operation}-${placementId ?? decisionId}-confirm`}
            checked={confirmed}
            onCheckedChange={(checked) => setConfirmed(checked === true)}
            disabled={mutation.isPending}
          />
          <Label
            htmlFor={`${operation}-${placementId ?? decisionId}-confirm`}
            className="text-sm font-normal leading-5"
          >
            I confirm this is an intentional operator action against the current canonical snapshot.
          </Label>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          type="button"
          variant={operation === "revoke" ? "destructive" : "default"}
          disabled={!formComplete || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Submitting…" : confirmLabel}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}