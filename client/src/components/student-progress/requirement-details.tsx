/**
 * Requirement-level detail from the S04 degree-progress endpoint, shown only
 * inside the Foundation expansion. Credit numbers on main surfaces come from
 * the roadmap ladder; this is explanatory detail.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import type { StudentDegreeProgressView } from "@shared/student-degree-progress-view";
import { DEGREE_PROGRESS_QUERY_KEY, DEGREE_PROGRESS_QUERY_OPTIONS } from "@/lib/student-progress-queries";
import { requirementStatusPresentation, sortRequirements } from "@/pages/student-progress-presentation";
import { requirementLine } from "@/pages/student-roadmap-presentation";
import { Pill } from "./student-ui";

export function RequirementDetails() {
  const { data, isLoading, error } = useQuery<StudentDegreeProgressView>({
    queryKey: [...DEGREE_PROGRESS_QUERY_KEY],
    ...DEGREE_PROGRESS_QUERY_OPTIONS,
  });
  if (isLoading) return <p className="py-2 text-sm text-student-muted" role="status">Loading requirement details</p>;
  if (error || !data) {
    return <p className="py-2 text-sm text-student-muted">Requirement details are not available right now.</p>;
  }
  if (data.requirements.length === 0) {
    return <p className="py-2 text-sm text-student-muted">Requirements will appear once your degree program is assigned.</p>;
  }
  return (
    <ul className="divide-y divide-student-line" data-testid="requirement-list">
      {sortRequirements(data.requirements).map((req) => {
        const status = requirementStatusPresentation(req.status);
        const line = requirementLine(req);
        return (
          <li key={req.requirementId} className="py-3" data-testid="requirement-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-student-ink">{req.title}</p>
              <Pill tone={req.status === "SATISFIED" ? "gold" : status.tone === "review" ? "attn" : "dashed"}>{status.label}</Pill>
            </div>
            {line ? (
              <p className="text-sm text-student-muted">
                {line.text} applied
                {line.surplusNote && <span className="block">{line.surplusNote}</span>}
              </p>
            ) : (
              <p className="text-sm text-student-muted">{status.hint}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
