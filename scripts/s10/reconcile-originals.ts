/**
 * S10 reconciliation: independent cell counts (count-originals.ts) vs the importer's output on the
 * SAME original bytes. Prints a de-identified markdown report (counts + sheet#row references only; no
 * workbook text) and writes the detailed comparison (with course text) to DIR/reconcile.json (SCRATCH ONLY).
 *
 *   npx tsx scripts/s10/reconcile-originals.ts --eph-locked F --eph-final F --eph-exec F --rut-a F --rut-b F --out DIR [--heading "..."]
 */
import fs from "node:fs";
import path from "node:path";
import { convertWorkbook, convertWorkbookPair } from "../../server/services/roadmap-import";
import type { ConversionResult, RoadmapContent, RoadmapItem } from "../../shared/student-roadmap-contract";
import { countExecEph, countMaster, countRut, identityTokens } from "./count-originals";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const need = (n: string): string => {
  const v = opt(n);
  if (!v) {
    console.error(`missing --${n}`);
    process.exit(2);
  }
  return v;
};
const F = { locked: need("eph-locked"), final: need("eph-final"), exec: need("eph-exec"), rutA: need("rut-a"), rutB: need("rut-b") };
const out = need("out");
const heading = opt("heading") ?? "Reconciliation";

const ALIAS: [RegExp, string][] = [
  [/^psych/, "psychology"],
  [/^soc(?!iology)/, "sociology"],
  [/^cj/, "criminaljustice"],
];
const aliasTok = (t: string): string => {
  for (const [re, to] of ALIAS) if (re.test(t)) return t.replace(re, to);
  return t;
};
const tokensOf = (s: string): Set<string> => new Set(identityTokens(s).map(aliasTok));
const itemTokens = (i: RoadmapItem): Set<string> => {
  const t = new Set<string>();
  for (const s of [i.title, i.code ?? "", `${i.code ?? ""} ${i.title}`]) for (const x of tokensOf(s)) t.add(x);
  return t;
};
const overlaps = (a: Set<string>, b: Set<string>): boolean => [...a].some((x) => b.has(x));

interface Expected {
  course: string;
  provider: string;
  refs: string;
}

function compareCourses(content: RoadmapContent | null, expected: Expected[]) {
  const items = content?.items ?? [];
  const preserved: Expected[] = [];
  const missing: Expected[] = [];
  const matchedItems = new Set<RoadmapItem>();
  for (const e of expected) {
    const et = tokensOf(e.course);
    const hit = items.find((i) => overlaps(et, itemTokens(i)));
    if (hit) {
      preserved.push(e);
      matchedItems.add(hit);
    } else missing.push(e);
  }
  const spurious = items.filter((i) => !matchedItems.has(i));
  return { preserved, missing, spurious };
}

function execStats(c: ConversionResult) {
  const content = c.content;
  const items = content?.items ?? [];
  const tasks = items.flatMap((i) => i.tasks);
  return {
    items: items.length,
    plannedCredits: items.reduce((n, i) => n + (i.planStatus === "planned" || i.planStatus === "hold" ? Number(i.credits ?? 0) || 0 : 0), 0),
    tasks: tasks.length,
    tasksWithDueDate: tasks.filter((t) => t.dueDate).length,
    tasksWithWeek: tasks.filter((t) => t.week).length,
    itemsWithPlannedStart: items.filter((i) => i.plannedStart).length,
    itemsWithPlannedEnd: items.filter((i) => i.plannedEnd).length,
    milestones: content?.milestones.length ?? 0,
    milestonesDated: content?.milestones.filter((m) => m.targetDate).length ?? 0,
    reportedHistoryCourses: content?.reportedHistory?.filter((h) => h.kind === "course" || h.kind === "transfer").length ?? 0,
    scheduleWeeks: content?.schedule?.weeks ?? null,
    scheduleStart: content?.schedule?.startsOn ?? null,
    itemsConditional: items.filter((i) => i.condition || i.equivalency || i.planStatus === "hold").length,
    unmatchedRows: c.exceptions.filter((e) => e.code === "COMPANION_ROW_UNMATCHED").length,
    exceptionsByCode: Object.fromEntries(
      Object.entries(c.exceptions.reduce<Record<string, number>>((m, e) => ((m[e.code] = (m[e.code] ?? 0) + 1), m), {})).sort(),
    ),
  };
}

const bufs = (p: string) => fs.readFileSync(p);
const md: string[] = [`## ${heading}`, ""];
const detail: Record<string, unknown> = {};
const row = (k: string, v: unknown) => md.push(`| ${k} | ${typeof v === "object" ? JSON.stringify(v) : v} |`);
const table = (title: string) => md.push(`#### ${title}`, "", "| Measure | Value |", "|---|---|");
const refsOf = (xs: { refs: string }[]) => xs.map((x) => x.refs.split(",")[0]).join(", ") || "none";

async function ephPair(label: string, masterFile: string) {
  const m = countMaster(masterFile);
  const e = countExecEph(F.exec);
  const res = await convertWorkbookPair(bufs(masterFile), bufs(F.exec), { fileName: "master.xlsx", companionFileName: "execution.xlsx" });
  const plan: Expected[] = m._detail.plan.map((p) => ({ course: p.course, provider: p.provider, refs: p.refs.join(",") }));
  const completed = m._detail.completed.map((c) => ({ course: c.course, provider: c.provider, refs: `${c.sheet}#${c.row}` }));
  const cmp = compareCourses(res.content, plan);
  const leaked = (res.content?.items ?? []).filter((i) => completed.some((c) => overlaps(tokensOf(c.course), itemTokens(i)))).length;
  const execCourses: Expected[] = [
    ...e._detail.external.map((x) => ({ course: x.course, provider: "external", refs: `EXTERNAL TRACKER#${x.row}` })),
    ...e._detail.tecep.map((x) => ({ course: x.course, provider: "tecep", refs: `TECEP TRACKER#${x.row}` })),
    ...e._detail.residency.map((x) => ({ course: x.course, provider: "tesu", refs: `TESU RESIDENCY#${x.row}` })),
  ];
  const execCmp = compareCourses(res.content, execCourses);
  const s = execStats(res);
  detail[label] = { missing: cmp.missing, spurious: cmp.spurious.map((i) => i.title), execMissing: execCmp.missing, stats: s };
  table(`${label}: independent counts vs importer`);
  row("master plan courses expected (remaining, de-duplicated across degree-block sheets)", `${m.planCourses} (${m.planCredits} credits); provider views agree: ${m.providerViewCourses}`);
  row("master Execution Order rows expected", `${m.executionOrderRows} (${m.executionOrderCourses} courses + ${m.executionOrderZeroCredit} zero-credit milestones)`);
  row("importer items", `${s.items} (planned credits ${s.plannedCredits})`);
  row("PRESERVED expected plan courses", `${cmp.preserved.length} of ${plan.length}`);
  row("MISSING expected plan courses", `${cmp.missing.length}${cmp.missing.length ? " (" + refsOf(cmp.missing) + ")" : ""}`);
  row("SPURIOUS items (not a real course: totals / note / footer rows)", `${cmp.spurious.length}`);
  row("completed ledger rows expected -> reportedHistory courses", `${m.completed.rows} (${m.completed.credits} cr) -> ${s.reportedHistoryCourses}`);
  row("completed courses leaked as plan items (must be 0)", leaked);
  row("conditional / working / watch plan courses expected vs items flagged", `${m.conditionalPlanCourses} vs ${s.itemsConditional}`);
  row("execution weeks expected vs schedule.weeks", `${e.weeks} (${e.firstWeekStart} to ${e.lastWeekEnd}) vs ${s.scheduleWeeks ?? "none"} (starts ${s.scheduleStart ?? "none"})`);
  row("execution lane cells expected (non-empty Course A/B/C)", e.laneCells);
  row("execution tracker courses expected (external + TECEP + residency)", `${e.externalCourses} + ${e.tecepCourses} + ${e.residencyCourses}; matched to items: ${execCourses.length - execCmp.missing.length}`);
  row("tasks / with week / with due date", `${s.tasks} / ${s.tasksWithWeek} / ${s.tasksWithDueDate}`);
  row("items with planned start / end (study.com finish targets expected: " + e.externalWithFinishTargetDate + ")", `${s.itemsWithPlannedStart} / ${s.itemsWithPlannedEnd}`);
  row("checkpoints expected vs milestones (dated)", `${e.checkpoints} + 2 closing steps vs ${s.milestones} (${s.milestonesDated})`);
  row("TECEP exam dates entered in source (unresolved by design)", e.tecepWithExamDate);
  row("TESU residency live-date placeholders empty (unresolved by design)", e.residencyDatePlaceholdersEmpty);
  row("COMPANION_ROW_UNMATCHED surfaced", s.unmatchedRows);
  row("exceptions by code", s.exceptionsByCode);
  md.push("");
}

async function rutRun(label: string, masterFile: string, companionFile: string | null, expectedFile: string) {
  const r = countRut(expectedFile);
  const res = companionFile ? await convertWorkbookPair(bufs(masterFile), bufs(companionFile), { fileName: "master.xlsx", companionFileName: "execution.xlsx" }) : await convertWorkbook(bufs(masterFile), { fileName: "master.xlsx" });
  const expected: Expected[] = [
    ...r._detail.sophia.map((x) => ({ course: x.course, provider: "Sophia", refs: `SOPHIA TRACKER#${x.row}` })),
    ...r._detail.studyCourses.map((x) => ({ course: x.course, provider: "Study.com", refs: `STUDY.COM TRACKER#${x.row}` })),
  ];
  const cmp = compareCourses(res.content, expected);
  const s = execStats(res);
  const items = res.content?.items ?? [];
  const challengeTasks = items.flatMap((i) => i.tasks).filter((t) => t.kind === "challenge").length;
  const milestoneTasks = items.flatMap((i) => i.tasks).filter((t) => t.kind === "milestone").length;
  const assignDated = items.flatMap((i) => i.tasks).filter((t) => (t.kind === "assignment" || t.kind === "paper") && t.dueDate).length;
  detail[label] = { missing: cmp.missing, spurious: cmp.spurious.map((i) => i.title), stats: s };
  table(`${label}: independent counts vs importer`);
  row("tracker courses expected (Sophia + Study.com)", `${r.sophiaCourses} + ${r.studyComCourses} = ${expected.length} (${r.totalCredits} credits)`);
  row("importer items (planned credits)", `${s.items} (${s.plannedCredits})`);
  row("PRESERVED / MISSING / SPURIOUS", `${cmp.preserved.length} / ${cmp.missing.length}${cmp.missing.length ? " (" + refsOf(cmp.missing) + ")" : ""} / ${cmp.spurious.length}`);
  row("Sophia challenges + milestones expected vs challenge/milestone tasks", `${r.sophiaChallenges} + ${r.sophiaMilestones} vs ${challengeTasks} + ${milestoneTasks}`);
  row("Study.com papers expected / assignment rows with due date / dated assignment tasks", `${r.studyComPapers} / ${r.assignmentRowsWithDueDate} / ${assignDated}`);
  row("weeks expected vs schedule.weeks", `${r.weeks} (${r.firstWeekStart} to ${r.lastWeekEnd}) vs ${s.scheduleWeeks ?? "none"} (starts ${s.scheduleStart ?? "none"})`);
  row("weekly due tokens expected (course + assignment/final + date)", r.weeklyDueTokens);
  row("conditional lane (replacement-only course) expected vs items flagged", `${r.weeksWithConditionalLane} vs ${s.itemsConditional}`);
  row("tasks / with week / with due date", `${s.tasks} / ${s.tasksWithWeek} / ${s.tasksWithDueDate}`);
  row("milestones (dated)", `${s.milestones} (${s.milestonesDated})`);
  row("COMPANION_ROW_UNMATCHED surfaced", s.unmatchedRows);
  row("exceptions by code", s.exceptionsByCode);
  md.push("");
}

await ephPair("EPH locked master + execution", F.locked);
await ephPair("EPH final master + execution", F.final);
await rutRun("RUT final-v2-1 alone (execution-only path)", F.rutB, null, F.rutB);
await rutRun("RUT orientation-v3-1 alone (execution-only path)", F.rutA, null, F.rutA);
await rutRun("RUT orientation (master) + final-v2-1 (companion)", F.rutA, F.rutB, F.rutB);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "reconcile.json"), JSON.stringify(detail, null, 2));
console.log(md.join("\n"));
