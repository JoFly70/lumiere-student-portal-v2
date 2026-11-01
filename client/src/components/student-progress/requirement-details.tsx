/**
 * Requirement-level detail from the S04 degree-progress endpoint, shown only
 * inside the Foundation expansion. Credit numbers on main surfaces come from
 * the roadmap ladder; this is explanatory detail.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import { DEGREE_PROGRESS_QUERY_KEY, DEGREE_PROGRESS_QUERY_OPTIONS } from "@/lib/student-progress-queries";
import { formatDecimal, requirementStatusPresentation, sortRequirements } from "@/pages/student-progress-presentation";
import { useS27T } from "@/lib/s27/i18n-util";
import type { TranslationKey } from "@/i18n";
import { Pill } from "./student-ui";

export function RequirementDetails() {
  const { t, lang, pl } = useS27T();
  const k = (key: string) => t(`s32.fnd.${key}` as TranslationKey);
  const dec = (v: string): string => (lang === "fr" ? v.replace(".", ",") : v);
  const hund = (v: string | null): number | null => (v === null || !/^\d+(\.\d+)?$/.test(v) ? null : Math.round(Number(v) * 100));
  const fromH = (n: number) => dec(formatDecimal(String(n / 100)) ?? String(n / 100));
  const STATUS: Record<string, { label: string; hint: string }> = {
    SATISFIED: { label: k("req.satisfied"), hint: k("req.satisfied.hint") },
    PARTIAL: { label: k("req.partial"), hint: k("req.partial.hint") },
    MISSING: { label: k("req.missing"), hint: k("req.missing.hint") },
    CONFLICT: { label: k("req.review"), hint: k("req.conflict.hint") },
    MANUAL_REVIEW: { label: k("req.review"), hint: k("req.manual.hint") },
  };
  const { data, isLoading, error } = useQuery<StudentDegreeProgressView>({
    queryKey: [...DEGREE_PROGRESS_QUERY_KEY],
    ...DEGREE_PROGRESS_QUERY_OPTIONS,
  });
  if (isLoading) return <p className="py-2 text-sm text-student-muted" role="status">{k("req.loading")}</p>;
  if (error || !data) {
    return <p className="py-2 text-sm text-student-muted">{k("req.unavailable")}</p>;
  }
  if (data.requirements.length === 0) {
    return <p className="py-2 text-sm text-student-muted">{k("req.empty")}</p>;
  }
  return (
    <ul className="divide-y divide-student-line" data-testid="requirement-list">
      {sortRequirements(data.requirements).map((req) => {
        const status = requirementStatusPresentation(req.status);
        const text = STATUS[req.status] ?? STATUS.MANUAL_REVIEW!;
        const applied = hund(req.appliedAmount);
        const required = hund(req.requiredAmount);
        const hasLine = applied !== null && required !== null;
        const shown = hasLine ? Math.min(applied, required) : 0;
        const surplus = hasLine && applied > required ? fromH(applied - required) : null;
        return (
          <li key={req.requirementId} className="py-3" data-testid="requirement-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-student-ink">{req.title}</p>
              <Pill tone={req.status === "SATISFIED" ? "gold" : status.tone === "review" ? "attn" : "dashed"}>{text.label}</Pill>
            </div>
            {hasLine ? (
              <p className="text-sm text-student-muted">
                {pl("s32.fnd.req.line", required / 100, { a: fromH(shown), r: fromH(required) })}
                {surplus && <span className="block">{t("s32.fnd.req.surplusNote", { n: surplus })}</span>}
              </p>
            ) : (
              <p className="text-sm text-student-muted">{text.hint}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
