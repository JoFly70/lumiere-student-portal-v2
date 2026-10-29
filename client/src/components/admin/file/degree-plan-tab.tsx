/**
 * Student file, Degree plan tab for degree students (S27): "Where the credits come from" (stacked bar by source,
 * from the credit records the existing workspace API returns), open checks (the report's attention items) and
 * links to the existing degree roadmap and academic workspace pages. Nothing is recomputed against requirements.
 */
import React from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { StaffEmpty, staffBtn } from "@/components/staff/staff-ui";
import { academicCreditRows, attentionItemLabel, attentionItemStatus, isDiagnosticAttentionItem, type WorkspaceViewModel } from "@/pages/admin-student-workspace-presentation";
import { creditsBySource } from "@/lib/file-decisions";
import { useT, type TranslationKey } from "@/i18n";
import { TonePill, ownerBtn } from "@/components/admin/control/owner-ui";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/owner-presentation";
import { Panel } from "./file-parts";

const SWATCH = ["bg-st-applied", "bg-st-progress", "bg-student-gold", "bg-st-provider", "bg-st-submitted", "bg-st-attention"];
const CHECK: Record<string, { tone: Tone; key: TranslationKey }> = {
  MANUAL_REVIEW: { tone: "attention", key: "owner.plan.chk.hold" },
  CONFLICT: { tone: "urgent", key: "owner.plan.chk.conflict" },
  MISSING: { tone: "urgent", key: "owner.plan.chk.open" },
  PARTIAL: { tone: "attention", key: "owner.plan.chk.watch" },
};
const fmtN = (n: number) => String(Math.round(n * 100) / 100);

export function DegreePlanTab({ studentId, vm }: { studentId: string; vm?: WorkspaceViewModel | null }) {
  const { t } = useT();
  const base = `/admin/students/${encodeURIComponent(studentId)}`;
  if (!vm) {
    return (
      <StaffEmpty title={t("owner.plan.none.title")} testId="degree-empty" action={<Link href={`${base}/roadmap`} className={cn(ownerBtn.primary, "inline-flex items-center border")}>{t("owner.plan.open")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>}>
        {t("owner.plan.none.body")}
      </StaffEmpty>
    );
  }
  const sources = creditsBySource(academicCreditRows(vm.academicDetail) as never, t("owner.plan.otherSource"));
  const total = sources.reduce((a, s) => a + s.accepted + s.waiting, 0);
  const accepted = sources.reduce((a, s) => a + s.accepted, 0);
  const checks = vm.attention.items;
  return (
    <div className="space-y-6" data-testid="degree-plan-tab">
      <Panel id="dp-sources" title={t("owner.plan.where", { n: fmtN(accepted) })} testId="degree-sources"
        actions={<Link href={`${base}/roadmap`} className={cn(ownerBtn.seal, "inline-flex items-center")} data-testid="degree-open-full">{t("owner.plan.open")}</Link>}>
        {total === 0 ? <p className="text-sm text-student-muted">{t("owner.plan.noCredits")}</p> : (
          <>
            <div role="img" aria-label={sources.map((s) => `${s.source}: ${fmtN(s.accepted + s.waiting)}`).join(", ")} className="flex h-3 overflow-hidden rounded-full bg-student-line">
              {sources.map((s, i) => (s.accepted + s.waiting > 0 ? <span key={s.source} className={cn("h-full border-r-2 border-student-card last:border-r-0", SWATCH[i % SWATCH.length])} style={{ width: `${((s.accepted + s.waiting) / total) * 100}%` }} /> : null))}
            </div>
            <ul className="mt-4 space-y-2" data-testid="degree-source-list">
              {sources.map((s, i) => (
                <li key={s.source} className="flex items-center gap-3 text-sm">
                  <span aria-hidden="true" className={cn("h-3 w-3 shrink-0 rounded-sm", SWATCH[i % SWATCH.length])} />
                  <span className="min-w-0 flex-1 truncate text-student-ink">{s.source}</span>
                  {s.waiting > 0 ? <span className="text-xs text-student-muted">{t("owner.plan.waiting", { n: fmtN(s.waiting) })}</span> : null}
                  <span className="font-semibold tabular-nums text-student-ink">{fmtN(s.accepted)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel id="dp-checks" title={t("owner.plan.checks")} testId="degree-checks">
        {checks.length === 0 ? <p className="text-sm text-student-muted">{t("owner.plan.noChecks")}</p> : (
          <ul>
            {checks.map((item, i) => {
              const diagnostic = isDiagnosticAttentionItem(item);
              const status = diagnostic ? "MANUAL_REVIEW" : String(attentionItemStatus(vm, item) ?? "MANUAL_REVIEW");
              const meta = CHECK[status] ?? CHECK.MANUAL_REVIEW!;
              const label = diagnostic ? String((item as { message?: unknown }).message ?? "") : attentionItemLabel(vm.labels, item);
              return (
                <li key={i} className="flex items-center justify-between gap-3 border-t border-student-line py-2.5 text-sm first:border-t-0 first:pt-0" data-testid="degree-check">
                  <span className="min-w-0 break-words text-student-ink">{label}</span>
                  <TonePill tone={meta.tone}>{t(meta.key)}</TonePill>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <p className="text-sm text-student-muted">
        {t("owner.plan.more")} <Link href={`${base}/workspace`} className="font-medium text-student-gold-ink underline underline-offset-4">{t("owner.plan.workspace")}</Link>
      </p>
    </div>
  );
}
