/**
 * S08 — verify and list optional academic context for a support ticket.
 *
 * Read-only: works on an already loaded StudentRoadmapView (the student's
 * CURRENT PUBLISHED plan) and never modifies anything. Only active items
 * (planStatus planned or hold) are valid context.
 */
import type { StudentRoadmapView, StudentRoadmapItemView } from "@shared/student-roadmap-contract";
import type { SupportContext } from "@shared/support-contract";

export interface SupportContextOption {
  readonly key: string;
  readonly title: string;
  readonly code: string | null;
  readonly kind: string;
  readonly phaseTitle: string;
}

export interface SupportContextOptions {
  readonly available: boolean;
  readonly planVersion: number | null;
  readonly items: readonly SupportContextOption[];
}

const isActive = (item: Pick<StudentRoadmapItemView, "planStatus">): boolean =>
  item.planStatus === "planned" || item.planStatus === "hold";

function isPublished(view: StudentRoadmapView | null | undefined): view is StudentRoadmapView {
  return !!view && view.state === "PUBLISHED" && !view.preview && !!view.plan;
}

export function listContextOptions(view: StudentRoadmapView | null | undefined): SupportContextOptions {
  if (!isPublished(view)) return { available: false, planVersion: null, items: [] };
  const items: SupportContextOption[] = [];
  for (const phase of view.phases ?? []) {
    for (const item of phase.items ?? []) {
      if (!isActive(item)) continue;
      items.push({ key: item.key, title: item.title, code: item.code ?? null, kind: item.kind, phaseTitle: phase.title });
    }
  }
  return { available: true, planVersion: view.plan!.versionNumber, items };
}

/** Returns the verified snapshot, or null when the key is not an active item of the published plan. */
export function verifyRoadmapContext(
  view: StudentRoadmapView | null | undefined,
  itemKey: string,
  now: Date,
): SupportContext | null {
  if (!isPublished(view)) return null;
  for (const phase of view.phases ?? []) {
    for (const item of phase.items ?? []) {
      if (item.key !== itemKey || !isActive(item)) continue;
      return {
        kind: "roadmap_item",
        itemKey: item.key,
        title: item.title,
        code: item.code ?? null,
        itemKind: item.kind,
        planVersion: view.plan!.versionNumber,
        verifiedAt: now.toISOString(),
      };
    }
  }
  return null;
}
