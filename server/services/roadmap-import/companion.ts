/**
 * Companion merge: a master academic conversion + an execution workbook
 * -> ONE draft, without duplicating courses.
 *
 * Execution rows are matched to master items by normalised code, then by
 * normalised title (provider prefixes and subject abbreviations normalised; a
 * title-only match must not cross provider families). Matched rows contribute
 * planned dates and dated tasks. Course-like rows with no master match are NOT
 * added (COMPANION_ROW_UNMATCHED); non-course milestones become roadmap
 * milestones. Pure and deterministic: the same inputs give the same output.
 */
import type { ConversionResult, RoadmapContent, RoadmapItem } from "@shared/student-roadmap-contract";
import { finalizeContent } from "./finalize";
import { executionSheets, parseExecution, EXECUTION_V1_ID, type ExecCourse } from "./execution-v1";
import { ExceptionCollector, type WorkbookData } from "./types";
import { norm, slug } from "./util";
import { CONVERSION_ONLY_CODES, familyOf, looseCourseIds, parseCourseText } from "./s07-shared";

export interface CompanionContext {
  readonly masterFileName: string | null;
  readonly companionFileName: string | null;
}

export function mergeCompanionConversion(master: ConversionResult, execution: WorkbookData, ctx: CompanionContext): ConversionResult {
  const combinedName = ctx.masterFileName && ctx.companionFileName ? `${ctx.masterFileName} + ${ctx.companionFileName}`.slice(0, 255) : master.summary.fileName;
  if (!master.content) return { ...master, summary: { ...master.summary, fileName: combinedName } };

  const exec = parseExecution(execution);
  const ex = new ExceptionCollector();
  ex.addAll(master.exceptions.filter((e) => CONVERSION_ONLY_CODES.has(e.code)));

  const recognised = exec.courses.length > 0 || exec.milestones.length > 0 || exec.schedule.startsOn !== null;
  if (!recognised) {
    const names = executionSheets(execution).map((s) => s.sheet.name);
    ex.add(
      "UNKNOWN_TEMPLATE",
      "warning",
      `The companion execution workbook was not recognised (no course cards, weekly schedule, activity list or milestone list found in: ${names.join(", ") || "no sheets"}). The master workbook was imported on its own.`,
      { sheet: names[0] ?? "(companion workbook)" },
      "companion",
    );
    const finalized = finalizeContent(master.content, ex.list);
    return { ...master, content: finalized.content ?? master.content, exceptions: finalized.exceptions, summary: { ...master.summary, fileName: combinedName } };
  }
  ex.addAll(exec.exceptions);

  const content: RoadmapContent = JSON.parse(JSON.stringify(master.content)) as RoadmapContent;

  // Master identity indexes
  const byCode = new Map<string, RoadmapItem[]>();
  const byTitle = new Map<string, RoadmapItem[]>();
  const push = (m: Map<string, RoadmapItem[]>, id: string, item: RoadmapItem) => {
    if (id.length < 4) return;
    const list = m.get(id) ?? [];
    if (!list.includes(item)) list.push(item);
    m.set(id, list);
  };
  for (const item of content.items) {
    if (item.code) {
      push(byCode, norm(item.code), item);
      for (const id of looseCourseIds(item.code)) push(byCode, id, item);
      for (const id of parseCourseText(item.code).ids) push(byCode, id, item);
    }
    push(byTitle, norm(item.title), item);
    for (const id of parseCourseText(item.title).ids) push(byTitle, id, item);
  }
  const compatible = (course: ExecCourse, item: RoadmapItem): boolean => {
    const a = familyOf(course.provider);
    const b = familyOf(item.provider);
    return a === "other" || b === "other" || a === b;
  };
  const matchItem = (course: ExecCourse): RoadmapItem | undefined => {
    const codeIds = [...(course.code ? [norm(course.code), ...looseCourseIds(course.code)] : []), ...course.ids];
    for (const id of codeIds) {
      const hit = byCode.get(id)?.find((i) => compatible(course, i));
      if (hit) return hit;
    }
    for (const id of course.ids) {
      const hit = byTitle.get(id)?.find((i) => compatible(course, i));
      if (hit) return hit;
    }
    return undefined;
  };

  const file = ctx.companionFileName ? ctx.companionFileName.slice(0, 200) : null;
  const matchedCourses = new Map<ExecCourse, RoadmapItem>();
  for (const course of exec.courses) {
    const item = matchItem(course);
    if (!item) {
      const at = course.rows[0]!;
      ex.add(
        "COMPANION_ROW_UNMATCHED",
        "warning",
        `Execution workbook row ${at.row} (${at.sheet}) looks like a course ("${[course.code, course.title].filter(Boolean).join(" ")}") but matches no course in the master workbook. It was NOT added to the plan. Add it to the master workbook, or confirm it should not be scheduled.`,
        { sheet: at.sheet, row: at.row },
      );
      continue;
    }
    matchedCourses.set(course, item);
  }

  for (const [course, item] of matchedCourses) {
    const at = course.rows[0]!;
    const ref = { sheet: at.sheet, row: at.row, itemKey: item.key };
    // dates: master's hard end/exam date wins; execution fills blanks
    const examTask = course.tasks.find((t) => t.key === "final-exam");
    const execEnd = examTask?.dueDate ?? course.plannedEnd;
    if (item.plannedEnd && execEnd && item.plannedEnd !== execEnd) {
      ex.add(
        "DEADLINE_CONFLICT",
        "warning",
        `"${item.title}": the master workbook ends/examines it on ${item.plannedEnd} but the execution workbook says ${execEnd}. The master date was kept; confirm which is correct.`,
        ref,
        "end",
      );
    } else if (!item.plannedEnd && course.plannedEnd) item.plannedEnd = course.plannedEnd;
    if (!item.plannedStart && course.plannedStart) item.plannedStart = course.plannedStart;

    // tasks: merge by key; execution contributes due dates / week and any extra tasks
    const tasks = [...item.tasks];
    for (const t of course.tasks) {
      const existing = tasks.find((x) => x.key === t.key);
      if (existing) {
        if (t.dueDate && !existing.dueDate) existing.dueDate = t.dueDate;
        if (t.week && !existing.week) existing.week = t.week;
      } else if (tasks.length < 100) {
        tasks.push({ key: t.key, kind: t.kind, title: t.title, sequence: tasks.length + 1, dueDate: t.dueDate, week: t.week });
      }
    }
    item.tasks = tasks.map((t, i) => ({ ...t, sequence: i + 1 }));
    const prov = course.rows.slice(0, 3).map((r) => ({ file, sheet: r.sheet.slice(0, 120), row: r.row, role: "execution" as const }));
    item.provenance = [...item.provenance, ...prov].slice(0, 10);
    ex.add(
      "COMPANION_ITEM_MERGED",
      "info",
      `Execution schedule merged into "${item.title}": ${course.plannedStart ?? "no start"} to ${course.plannedEnd ?? "no end"}, ${course.tasks.length} scheduled task(s).`,
      ref,
    );
  }

  for (const conflict of exec.conflicts) {
    const item = matchedCourses.get(conflict.course);
    ex.add(
      "DEADLINE_CONFLICT",
      "warning",
      `The execution workbook gives two different dates for ${conflict.what} of "${conflict.course.title}": ${conflict.a} and ${conflict.b}. The earlier row was kept; confirm the date.`,
      { sheet: conflict.sheet, row: conflict.row, ...(item ? { itemKey: item.key } : {}) },
      `${conflict.what}:${conflict.a}:${conflict.b}`,
    );
  }

  // Milestones (orientation, apply for graduation, conferral, ...)
  const primary = content.objectives.find((o) => o.kind === "primary") ?? content.objectives[0]!;
  const usedKeys = new Set(content.milestones.map((m) => m.key));
  for (const m of exec.milestones) {
    const existing = content.milestones.find((x) => norm(x.title) === norm(m.title));
    if (existing) {
      if (!existing.targetDate && m.date) existing.targetDate = m.date;
      else if (existing.targetDate && m.date && existing.targetDate !== m.date) {
        ex.add(
          "DEADLINE_CONFLICT",
          "warning",
          `Milestone "${existing.title}" is ${existing.targetDate} in the master workbook and ${m.date} in the execution workbook. The master date was kept.`,
          { sheet: m.sheet, row: m.row, path: `milestones.${existing.key}` },
          "milestone",
        );
      }
      continue;
    }
    if (content.milestones.length >= 100) break;
    let key = slug(m.title, 76) || `milestone-${content.milestones.length + 1}`;
    let n = 1;
    while (usedKeys.has(key)) key = `${slug(m.title, 70)}-${++n}`;
    usedKeys.add(key);
    content.milestones.push({ key, title: m.title, kind: m.kind, targetDate: m.date, objectiveKey: primary.key, afterItemKeys: [] });
  }

  // Schedule metadata
  const s = exec.schedule;
  if (s.preparedOn || s.startsOn || s.weeks || s.label) {
    content.schedule = {
      preparedOn: s.preparedOn ?? content.schedule?.preparedOn ?? null,
      startsOn: s.startsOn ?? content.schedule?.startsOn ?? null,
      weeks: s.weeks ?? content.schedule?.weeks ?? null,
      label: s.label ?? content.schedule?.label ?? null,
    };
  }

  const finalized = finalizeContent(content, ex.list);
  return {
    templateId: `${master.templateId}+${EXECUTION_V1_ID}`,
    content: finalized.content,
    exceptions: finalized.exceptions,
    summary: {
      kind: "workbook",
      fileName: combinedName,
      sheetsRead: [...master.summary.sheetsRead, ...exec.sheetsRead.map((n) => `${n} (execution)`)],
      rowsRead: master.summary.rowsRead + exec.rowsRead,
      rowsConverted: master.summary.rowsConverted,
      rowsSkipped: master.summary.rowsSkipped,
      generator: null,
    },
  };
}
