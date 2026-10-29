/**
 * S05 — pure validation and diff for RoadmapContent (no I/O, deterministic).
 *
 * validateRoadmapContent : semantic checks on a schema-valid document.
 * diffRoadmapContent     : published-vs-draft comparison by stable item key.
 * parseRoadmapContent    : zod parse -> blocking exceptions with paths.
 *
 * Exception keys are deterministic (`${code}:${stable ref}`) and every key is
 * unique within one call, so staff acknowledgements survive re-validation.
 */
import {
  roadmapContentSchema,
  type DiffRoadmapContent,
  type RoadmapContent,
  type RoadmapDiff,
  type RoadmapException,
  type RoadmapExceptionCode,
  type RoadmapExceptionRef,
  type RoadmapExceptionSeverity,
  type RoadmapItem,
  type ValidateRoadmapContent,
} from "./student-roadmap-contract";

// ── helpers ──────────────────────────────────────────────────────────────────

class ExceptionList {
  private readonly seen = new Set<string>();
  readonly list: RoadmapException[] = [];

  add(
    code: RoadmapExceptionCode,
    severity: RoadmapExceptionSeverity,
    keyRef: string,
    message: string,
    ref: RoadmapExceptionRef = {},
  ): void {
    const key = `${code}:${keyRef}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.list.push({ key, code, severity, message, ref });
  }
}

function isRealIsoDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Stable JSON: sorted keys, undefined -> null, so equality ignores key order. */
function canonical(value: unknown): string {
  return JSON.stringify(normalize(value));
}
function normalize(value: unknown): unknown {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = normalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

// ── validateRoadmapContent ───────────────────────────────────────────────────

export const validateRoadmapContent: ValidateRoadmapContent = (content) => {
  const ex = new ExceptionList();

  // Objectives
  const objectiveKeys = new Set<string>();
  const dupObjectives = new Set<string>();
  for (const o of content.objectives) {
    if (objectiveKeys.has(o.key)) dupObjectives.add(o.key);
    objectiveKeys.add(o.key);
  }
  for (const key of dupObjectives) {
    ex.add("DUPLICATE_OBJECTIVE_KEY", "blocking", key, `Objective key "${key}" is used more than once.`, { path: `objectives.${key}` });
  }
  const primaries = content.objectives.filter((o) => o.kind === "primary");
  if (primaries.length === 0) {
    ex.add("NO_PRIMARY_OBJECTIVE", "blocking", "objectives", "The roadmap needs exactly one primary objective (the assigned degree).", { path: "objectives" });
  } else if (primaries.length > 1) {
    ex.add(
      "MULTIPLE_PRIMARY_OBJECTIVES",
      "blocking",
      "objectives",
      `Only one objective may be primary; found ${primaries.length} (${primaries.map((p) => p.key).join(", ")}).`,
      { path: "objectives" },
    );
  }

  // Phases
  const phaseKeys = new Set<string>();
  const dupPhases = new Set<string>();
  for (const p of content.phases) {
    if (phaseKeys.has(p.key)) dupPhases.add(p.key);
    phaseKeys.add(p.key);
    if (p.objectiveKey && !objectiveKeys.has(p.objectiveKey)) {
      ex.add("UNKNOWN_OBJECTIVE", "blocking", `phase:${p.key}`, `Phase "${p.key}" refers to unknown objective "${p.objectiveKey}".`, { path: `phases.${p.key}.objectiveKey` });
    }
    for (const field of ["startDate", "endDate"] as const) {
      const v = p[field];
      if (v && !isRealIsoDate(v)) {
        ex.add("INVALID_DATE", "blocking", `phase:${p.key}:${field}`, `Phase "${p.key}" ${field} "${v}" is not a real calendar date.`, { path: `phases.${p.key}.${field}`, column: field });
      }
    }
    if (p.startDate && p.endDate && isRealIsoDate(p.startDate) && isRealIsoDate(p.endDate) && p.endDate < p.startDate) {
      ex.add("DATE_ORDER", "warning", `phase:${p.key}`, `Phase "${p.title}" ends (${p.endDate}) before it starts (${p.startDate}).`, { path: `phases.${p.key}` });
    }
  }
  for (const key of dupPhases) {
    ex.add("DUPLICATE_PHASE_KEY", "blocking", key, `Phase key "${key}" is used more than once.`, { path: `phases.${key}` });
  }

  // Items
  const itemByKey = new Map<string, RoadmapItem>();
  const dupItems = new Set<string>();
  for (const item of content.items) {
    if (itemByKey.has(item.key)) dupItems.add(item.key);
    else itemByKey.set(item.key, item);
  }
  for (const key of dupItems) {
    ex.add("DUPLICATE_ITEM_KEY", "blocking", key, `Item key "${key}" is used more than once; progress is keyed by item key, so keys must be unique.`, { itemKey: key });
  }

  for (const item of content.items) {
    const ref = { itemKey: item.key };
    if (!phaseKeys.has(item.phaseKey)) {
      ex.add("UNKNOWN_PHASE", "blocking", item.key, `Item "${item.title}" refers to unknown phase "${item.phaseKey}".`, ref);
    }
    if (!objectiveKeys.has(item.objectiveKey)) {
      ex.add("UNKNOWN_OBJECTIVE", "blocking", item.key, `Item "${item.title}" refers to unknown objective "${item.objectiveKey}".`, ref);
    }
    const seenTasks = new Set<string>();
    for (const t of item.tasks) {
      if (seenTasks.has(t.key)) {
        ex.add("DUPLICATE_TASK_KEY", "blocking", `${item.key}/${t.key}`, `Item "${item.key}" has more than one task with key "${t.key}".`, { itemKey: item.key, taskKey: t.key });
      }
      seenTasks.add(t.key);
    }
    for (const dep of item.dependsOn) {
      if (!itemByKey.has(dep)) {
        ex.add("UNKNOWN_DEPENDENCY", "blocking", `${item.key}>${dep}`, `Item "${item.title}" depends on unknown item "${dep}".`, { itemKey: item.key });
      }
    }
    if (item.alternativeOf) {
      if (!itemByKey.has(item.alternativeOf) || item.alternativeOf === item.key) {
        ex.add("ALTERNATIVE_UNKNOWN_TARGET", "blocking", item.key, `Item "${item.title}" is an alternative of "${item.alternativeOf}", which is not another item in this plan.`, { itemKey: item.key });
      }
    }
    for (const field of ["plannedStart", "plannedEnd"] as const) {
      const v = item[field];
      if (v && !isRealIsoDate(v)) {
        ex.add("INVALID_DATE", "blocking", `${item.key}:${field}`, `Item "${item.title}" ${field} "${v}" is not a real calendar date.`, { itemKey: item.key, column: field });
      }
    }
    if (item.plannedStart && item.plannedEnd && isRealIsoDate(item.plannedStart) && isRealIsoDate(item.plannedEnd) && item.plannedEnd < item.plannedStart) {
      ex.add("DATE_ORDER", "warning", item.key, `Item "${item.title}" ends (${item.plannedEnd}) before it starts (${item.plannedStart}).`, ref);
    }
    if (item.planStatus === "hold" && !(item.hold && item.hold.reason && item.hold.reason.trim())) {
      ex.add("HOLD_WITHOUT_REASON", "blocking", item.key, `Item "${item.title}" is on hold but has no hold reason to show the student.`, ref);
    }
  }

  // Dependency cycles (Tarjan SCC over known edges, deterministic by content order)
  for (const cycle of findCycles(content)) {
    const first = cycle[0]!;
    ex.add("DEPENDENCY_CYCLE", "blocking", first, `Dependency cycle between items: ${cycle.join(" -> ")} -> ${first}.`, { itemKey: first });
  }

  // Milestones
  const milestoneKeys = new Set<string>();
  for (const m of content.milestones) {
    if (milestoneKeys.has(m.key)) {
      ex.add("DUPLICATE_ITEM_KEY", "blocking", `milestone:${m.key}`, `Milestone key "${m.key}" is used more than once.`, { path: `milestones.${m.key}` });
    }
    milestoneKeys.add(m.key);
    if (m.objectiveKey && !objectiveKeys.has(m.objectiveKey)) {
      ex.add("UNKNOWN_OBJECTIVE", "blocking", `milestone:${m.key}`, `Milestone "${m.title}" refers to unknown objective "${m.objectiveKey}".`, { path: `milestones.${m.key}.objectiveKey` });
    }
    if (m.targetDate && !isRealIsoDate(m.targetDate)) {
      ex.add("INVALID_DATE", "blocking", `milestone:${m.key}`, `Milestone "${m.title}" target date "${m.targetDate}" is not a real calendar date.`, { path: `milestones.${m.key}.targetDate` });
    }
    for (const k of m.afterItemKeys) {
      if (!itemByKey.has(k)) {
        ex.add("UNKNOWN_MILESTONE_ITEM", "blocking", `${m.key}>${k}`, `Milestone "${m.title}" waits on unknown item "${k}".`, { path: `milestones.${m.key}.afterItemKeys` });
      }
    }
  }

  return ex.list;
};

/** Returns each dependency cycle as an ordered list of item keys starting at the earliest-in-content member. */
function findCycles(content: RoadmapContent): string[][] {
  const order = new Map<string, number>();
  content.items.forEach((it, i) => {
    if (!order.has(it.key)) order.set(it.key, i);
  });
  const edges = new Map<string, string[]>();
  for (const it of content.items) {
    if (edges.has(it.key)) continue;
    edges.set(it.key, it.dependsOn.filter((d) => order.has(d)));
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  const strong = (v: string): void => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1 || (edges.get(v) ?? []).includes(v)) sccs.push(comp);
    }
  };
  for (const key of edges.keys()) if (!idx.has(key)) strong(key);

  return sccs
    .map((c) => c.sort((a, b) => order.get(a)! - order.get(b)!))
    .sort((a, b) => order.get(a[0]!)! - order.get(b[0]!)!);
}

// ── diffRoadmapContent ───────────────────────────────────────────────────────

const RESCHEDULE_FIELDS = new Set(["plannedStart", "plannedEnd", "sequence", "phaseKey", "taskSchedule"]);
// S07 fields are compared too; `provenance` is deliberately not (it is not a plan change).
const ITEM_FIELDS: readonly (keyof RoadmapItem)[] = [
  "phaseKey", "objectiveKey", "sequence", "kind", "code", "title", "provider", "institution", "providerUrl", "credits",
  "plannedStart", "plannedEnd", "dependsOn", "planStatus", "hold", "approval", "alternativeOf",
  "linkedCreditRecordId", "studentNote", "staffNote",
  "condition", "registration", "registrationGate", "creditUse", "equivalency",
];

/** Tasks compared without their schedule, so a due-date-only change counts as a reschedule. */
const taskIdentity = (item: RoadmapItem) => item.tasks.map(({ dueDate: _d, week: _w, ...t }) => t);
const taskSchedule = (item: RoadmapItem) => item.tasks.map((t) => [t.key, t.dueDate ?? null, t.week ?? null]);

function changedItemFields(before: RoadmapItem, item: RoadmapItem): string[] {
  const fields: string[] = ITEM_FIELDS.filter((f) => canonical(before[f]) !== canonical(item[f]));
  if (canonical(taskIdentity(before)) !== canonical(taskIdentity(item))) fields.push("tasks");
  else if (canonical(taskSchedule(before)) !== canonical(taskSchedule(item))) fields.push("taskSchedule");
  return fields;
}
const OBJECTIVE_FIELDS = ["title", "kind", "institution", "credentialLabel", "linkedToProgramAssignment", "status", "note"] as const;

export const diffRoadmapContent: DiffRoadmapContent = (previous, next, progressKeys, baseVersionNumber) => {
  const ex = new ExceptionList();

  if (!previous) {
    return {
      diff: {
        baseVersionNumber,
        added: next.items.map((i) => ({ itemKey: i.key, title: i.title })),
        removed: [],
        changed: [],
        unchangedCount: 0,
        objectivesAdded: next.objectives.map((o) => o.key),
        objectivesRemoved: [],
        objectivesChanged: [],
        phasesChanged: false,
        milestonesChanged: false,
      },
      exceptions: ex.list,
    };
  }

  const prevItems = new Map(previous.items.map((i) => [i.key, i] as const));
  const nextItems = new Map(next.items.map((i) => [i.key, i] as const));

  const added: { itemKey: string; title: string }[] = [];
  const changed: { itemKey: string; title: string; fields: string[]; rescheduleOnly: boolean }[] = [];
  let unchangedCount = 0;
  const seenNext = new Set<string>();

  for (const item of next.items) {
    if (seenNext.has(item.key)) continue;
    seenNext.add(item.key);
    const before = prevItems.get(item.key);
    if (!before) {
      added.push({ itemKey: item.key, title: item.title });
      continue;
    }
    const fields = changedItemFields(before, item);
    if (fields.length === 0) {
      unchangedCount++;
    } else {
      changed.push({
        itemKey: item.key,
        title: item.title,
        fields,
        rescheduleOnly: fields.every((f) => RESCHEDULE_FIELDS.has(f)),
      });
    }
    // A task with recorded progress dropped from a kept item.
    const progress = progressKeys.get(item.key);
    if (progress) {
      const nextTaskKeys = new Set(item.tasks.map((t) => t.key));
      for (const t of before.tasks) {
        if (!nextTaskKeys.has(t.key) && progress.has(t.key)) {
          ex.add(
            "PROGRESS_ON_REMOVED_TASK",
            "warning",
            `${item.key}/${t.key}`,
            `Task "${t.title}" was removed from "${item.title}" but the student has recorded progress on it. The progress is preserved in history and is NOT transferred to any other task.`,
            { itemKey: item.key, taskKey: t.key },
          );
        }
      }
    }
  }

  const removed: { itemKey: string; title: string; hasProgress: boolean }[] = [];
  const seenPrev = new Set<string>();
  for (const item of previous.items) {
    if (seenPrev.has(item.key)) continue;
    seenPrev.add(item.key);
    if (nextItems.has(item.key)) continue;
    const hasProgress = (progressKeys.get(item.key)?.size ?? 0) > 0;
    removed.push({ itemKey: item.key, title: item.title, hasProgress });
    if (hasProgress) {
      ex.add(
        "PROGRESS_ON_REMOVED_ITEM",
        "warning",
        item.key,
        `"${item.title}" is removed from the plan but the student has recorded progress on it. The progress is preserved in history and is NOT transferred to any replacement item.`,
        { itemKey: item.key },
      );
    }
  }

  // Objectives
  const prevObj = new Map(previous.objectives.map((o) => [o.key, o] as const));
  const nextObj = new Map(next.objectives.map((o) => [o.key, o] as const));
  const objectivesAdded = next.objectives.filter((o) => !prevObj.has(o.key)).map((o) => o.key);
  const objectivesRemoved = previous.objectives.filter((o) => !nextObj.has(o.key)).map((o) => o.key);
  const objectivesChanged = next.objectives
    .filter((o) => {
      const b = prevObj.get(o.key);
      return b ? OBJECTIVE_FIELDS.some((f) => canonical(b[f]) !== canonical(o[f])) : false;
    })
    .map((o) => o.key);

  const prevPrimary = previous.objectives.find((o) => o.kind === "primary");
  const nextPrimary = next.objectives.find((o) => o.kind === "primary");
  if (prevPrimary && nextPrimary && (prevPrimary.key !== nextPrimary.key || prevPrimary.title !== nextPrimary.title)) {
    ex.add(
      "OBJECTIVE_CHANGED",
      "warning",
      "primary",
      `The primary objective changed from "${prevPrimary.title}" (${prevPrimary.key}) to "${nextPrimary.title}" (${nextPrimary.key}). An objective change must be deliberate and match the student's canonical program assignment.`,
      { path: "objectives" },
    );
  }

  const diff: RoadmapDiff = {
    baseVersionNumber,
    added,
    removed,
    changed,
    unchangedCount,
    objectivesAdded,
    objectivesRemoved,
    objectivesChanged,
    phasesChanged: canonical(previous.phases) !== canonical(next.phases),
    milestonesChanged: canonical(previous.milestones) !== canonical(next.milestones),
  };
  return { diff, exceptions: ex.list };
};

// ── parseRoadmapContent ──────────────────────────────────────────────────────

const MAX_PARSE_ISSUES = 50;

export function parseRoadmapContent(input: unknown): { content: RoadmapContent | null; exceptions: RoadmapException[] } {
  const parsed = roadmapContentSchema.safeParse(input);
  if (parsed.success) return { content: parsed.data, exceptions: [] };
  const ex = new ExceptionList();
  for (const issue of parsed.error.issues.slice(0, MAX_PARSE_ISSUES)) {
    const path = issue.path.length ? issue.path.join(".") : "(root)";
    ex.add("PACKAGE_INVALID", "blocking", path, `${path}: ${issue.message}`, { path });
  }
  if (parsed.error.issues.length > MAX_PARSE_ISSUES) {
    ex.add("PACKAGE_INVALID", "blocking", "(more)", `${parsed.error.issues.length - MAX_PARSE_ISSUES} further validation problems were not listed.`, { path: "(more)" });
  }
  return { content: null, exceptions: ex.list };
}
