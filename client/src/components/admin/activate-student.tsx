/**
 * S32-B (SA-25): the ONE "Activate student" action, shared by the Student File, the Advanced Workspace and the older
 * high-school layout it hosts. Admin only (the server enforces PATCH /api/admin/students/:id/status for admins).
 * It asks for confirmation, shows what is (and is not yet) in place, and reports the outcome with a toast in the
 * person's language. Raw server text is never shown. Activation only changes the record status; it never marks a
 * document, payment or agreement as done.
 */
import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { apiRequest } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export interface ActivationFacts {
  /** Agreement signed (null = unknown). */
  readonly agreementSigned?: boolean | null;
  /** Agreed fee paid in full (null = unknown or no fee recorded). */
  readonly paidInFull?: boolean | null;
  /** Portal account linked (null = unknown). */
  readonly accountLinked?: boolean | null;
}

export function useActivateStudent(studentId: string, onActivated?: () => void | Promise<unknown>) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();
  return useMutation({
    mutationFn: () => apiRequest(`/api/admin/students/${encodeURIComponent(studentId)}/status`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [`/api/students/${encodeURIComponent(studentId)}`] }),
        qc.invalidateQueries({ queryKey: ["/api/admin/students"] }),
        qc.invalidateQueries({ queryKey: ["/api/students"] }),
      ]);
      await onActivated?.();
      toast({ title: t("s32.act.done") });
    },
    onError: () => toast({ title: t("s32.act.failed"), description: t("s32.act.failedBody"), variant: "destructive" }),
  });
}

function Fact({ ok, label }: { ok: boolean | null | undefined; label: string }) {
  const { t } = useT();
  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-student-line py-2 text-sm first:border-t-0">
      <span className="text-student-ink">{label}</span>
      <span className={cn("font-medium", ok ? "text-st-applied" : "text-st-attention")}>{ok === true ? t("s32.act.yes") : ok === false ? t("s32.act.no") : t("s32.act.unknown")}</span>
    </li>
  );
}

export function ActivateStudentButton({ studentId, studentName, facts, className, onActivated }: { studentId: string; studentName: string; facts?: ActivationFacts; className?: string; onActivated?: () => void | Promise<unknown> }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const activate = useActivateStudent(studentId, onActivated);
  return (
    <>
      <button type="button" className={className ?? cn(ownerBtn.outline, "border")} disabled={activate.isPending} onClick={() => setOpen(true)} data-testid="button-activate-lead">
        <UserCheck className="h-4 w-4" aria-hidden="true" />{activate.isPending ? t("owner.saving") : t("s32.act.button")}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("s32.act.title", { name: studentName })}</DialogTitle>
            <DialogDescription>{t("s32.act.body")}</DialogDescription>
          </DialogHeader>
          <ul data-testid="activate-facts">
            <Fact ok={facts?.agreementSigned} label={t("s32.act.agreement")} />
            <Fact ok={facts?.paidInFull} label={t("s32.act.payment")} />
            <Fact ok={facts?.accountLinked} label={t("s32.act.account")} />
          </ul>
          <DialogFooter>
            <button type="button" className={cn(ownerBtn.outline, "border")} onClick={() => setOpen(false)}>{t("owner.cancel")}</button>
            <button type="button" className={ownerBtn.seal} disabled={activate.isPending} onClick={() => activate.mutate(undefined, { onSettled: () => setOpen(false) })} data-testid="button-activate-confirm">{t("s32.act.confirm")}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
