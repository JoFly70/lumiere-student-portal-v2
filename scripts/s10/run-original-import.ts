/**
 * S10 — run REAL workbook files through the SAME pipeline the
 * POST /api/admin/students/:id/roadmap/imports route uses:
 *   readWorkbook -> adapter detect/convert -> (companion merge) -> finalize
 *   -> roadmapContentSchema parse -> validateRoadmapContent + diffRoadmapContent
 *   -> reviewRoadmapPlan (the service's `evaluate` composition).
 *
 *   npx tsx scripts/s10/run-original-import.ts --label NAME --master FILE [--companion FILE] --out DIR
 *        [--today YYYY-MM-DD]
 *
 * File paths are arguments; no student data is embedded here. Writes to DIR:
 *   NAME.raw.json      full result incl. messages (may contain student text: SCRATCH ONLY, never commit)
 *   NAME.summary.json  de-identified summary (sha256, sheet names, counts, codes) — safe to cite
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { convertWorkbook, convertWorkbookPair } from "../../server/services/roadmap-import";
import { readWorkbook } from "../../server/services/roadmap-import/reader";
import { roadmapContentSchema, type RoadmapException } from "../../shared/student-roadmap-contract";
import { diffRoadmapContent, validateRoadmapContent } from "../../shared/student-roadmap-validation";
import { reviewRoadmapPlan } from "../../shared/student-roadmap-plan-review";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const label = opt("label");
const masterPath = opt("master");
const companionPath = opt("companion");
const out = opt("out");
const today = opt("today") ?? new Date().toISOString().slice(0, 10);
if (!label || !masterPath || !out) {
  console.error("usage: --label NAME --master FILE [--companion FILE] --out DIR [--today YYYY-MM-DD]");
  process.exit(2);
}
const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const count = <T,>(xs: readonly T[], f: (x: T) => string) => {
  const m: Record<string, number> = {};
  for (const x of xs) m[f(x)] = (m[f(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(m).sort());
};

const masterBuf = fs.readFileSync(masterPath);
const companionBuf = companionPath ? fs.readFileSync(companionPath) : null;
const masterWb = await readWorkbook(masterBuf).catch((e: unknown) => ({ error: String(e) }));
const companionWb = companionBuf ? await readWorkbook(companionBuf).catch((e: unknown) => ({ error: String(e) })) : null;

const conversion = companionBuf
  ? await convertWorkbookPair(masterBuf, companionBuf, { fileName: path.basename(masterPath), companionFileName: path.basename(companionPath!) })
  : await convertWorkbook(masterBuf, { fileName: path.basename(masterPath) });

let exceptions: RoadmapException[] = [...conversion.exceptions];
let schemaOk = false;
let diffKeys: string[] | null = null;
if (conversion.content) {
  const parsed = roadmapContentSchema.safeParse(conversion.content);
  schemaOk = parsed.success;
  if (parsed.success) {
    const c = parsed.data;
    const { diff, exceptions: de } = diffRoadmapContent(null, c, new Map(), null);
    diffKeys = Object.keys(diff);
    const seen = new Set<string>();
    exceptions = [];
    for (const e of [...conversion.exceptions, ...validateRoadmapContent(c), ...de, ...reviewRoadmapPlan(c, { today, foundation: null, progressKeys: new Map() })]) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      exceptions.push(e);
    }
  }
}
const c = conversion.content;
const sheetNames = (wb: typeof masterWb) => (wb && "sheets" in wb ? wb.sheets.map((s) => s.name) : []);
const allSheets = [...sheetNames(masterWb).map((n) => `master:${n}`), ...sheetNames(companionWb).map((n) => `companion:${n}`)];
const readSet = new Set(
  conversion.summary.sheetsRead.map((s) => (s.endsWith(" (execution)") ? `companion:${s.replace(/ \(execution\)$/, "")}` : `master:${s}`)),
);
const summary = {
  label,
  files: [
    { role: "master", sha256: sha(masterBuf), bytes: masterBuf.length, originalBytesProcessed: true, sheets: sheetNames(masterWb) },
    ...(companionBuf ? [{ role: "companion", sha256: sha(companionBuf), bytes: companionBuf.length, originalBytesProcessed: true, sheets: sheetNames(companionWb) }] : []),
  ],
  readError: [masterWb, companionWb].filter((w) => w && "error" in w).map((w) => (w as { error: string }).error),
  templateId: conversion.templateId,
  sheetsRead: conversion.summary.sheetsRead,
  sheetsIgnored: allSheets.filter((s) => !readSet.has(s)),
  rows: { read: conversion.summary.rowsRead, converted: conversion.summary.rowsConverted, skipped: conversion.summary.rowsSkipped },
  contentProduced: !!c,
  schemaValid: schemaOk,
  counts: c
    ? {
        items: c.items.length,
        itemsByStatus: count(c.items, (i) => i.planStatus),
        // allow-list: any other provider text (e.g. a note row mis-read as an item) is bucketed, never echoed
        itemsByProvider: count(c.items, (i) => {
          const p = i.provider ?? "(none)";
          return /^(sophia|study\.com|csm learn|coopersmith|tesu online|tesu e-pack|tesu tecep|tesu residency|dallas college|\(none\))$/i.test(p) ? p : "(other/unrecognised text)";
        }),
        tasks: c.items.reduce((n, i) => n + i.tasks.length, 0),
        tasksByKind: count(c.items.flatMap((i) => i.tasks), (t) => t.kind),
        tasksDated: c.items.reduce((n, i) => n + i.tasks.filter((t) => t.dueDate).length, 0),
        milestones: c.milestones.length,
        phases: c.phases.length,
        objectives: c.objectives.length,
        reportedHistory: c.reportedHistory?.length ?? 0,
        schedule: c.schedule ?? null,
        itemsWithPlannedEnd: c.items.filter((i) => i.plannedEnd).length,
      }
    : null,
  exceptions: {
    total: exceptions.length,
    bySeverity: count(exceptions, (e) => e.severity),
    byCode: count(exceptions, (e) => `${e.code} [${e.severity}]`),
    blocking: exceptions.filter((e) => e.severity === "blocking").map((e) => ({ code: e.code, sheet: e.ref.sheet ?? null, row: e.ref.row ?? null })),
    unmatchedRows: exceptions.filter((e) => e.code === "COMPANION_ROW_UNMATCHED").map((e) => ({ sheet: e.ref.sheet ?? null, row: e.ref.row ?? null })),
  },
  diffAgainstEmptyKeys: diffKeys,
};
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, `${label}.raw.json`), JSON.stringify({ summary, conversion, exceptions }, null, 2));
fs.writeFileSync(path.join(out, `${label}.summary.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
