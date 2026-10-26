/**
 * S10 revised-workbook check: convert a BASE and a REVISED workbook (pair or single) with the real importer and run the
 * existing draft diff (`diffRoadmapContent`, the function the draft service uses) with simulated student progress on EVERY
 * base item and task (worst case). Reports whether progress on unchanged items is preserved (item stays out of
 * added/removed), whether swapped courses leave as `removed` with progress flagged, and that replacements arrive as `added`
 * under a new key (progress is keyed by itemKey, so a replacement cannot inherit completion).
 *
 *   npx tsx scripts/s10/diff-revision.ts --base-master F [--base-companion F] --rev-master F [--rev-companion F]
 *
 * Output is counts and public course keys only (no workbook text).
 */
import fs from "node:fs";
import { convertWorkbook, convertWorkbookPair } from "../../server/services/roadmap-import";
import { diffRoadmapContent, validateRoadmapContent } from "../../shared/student-roadmap-validation";
import type { ConversionResult } from "../../shared/student-roadmap-contract";

const args = process.argv.slice(2);
const opt = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const bm = opt("base-master");
const rm = opt("rev-master");
if (!bm || !rm) {
  console.error("usage: --base-master F [--base-companion F] --rev-master F [--rev-companion F]");
  process.exit(2);
}
async function conv(master: string, companion?: string): Promise<ConversionResult> {
  return companion
    ? convertWorkbookPair(fs.readFileSync(master), fs.readFileSync(companion), { fileName: "master.xlsx", companionFileName: "execution.xlsx" })
    : convertWorkbook(fs.readFileSync(master), { fileName: "master.xlsx" });
}
const base = await conv(bm, opt("base-companion"));
const rev = await conv(rm, opt("rev-companion"));
if (!base.content || !rev.content) {
  console.log(JSON.stringify({ error: "a version produced no content", baseOk: !!base.content, revOk: !!rev.content }));
  process.exit(1);
}
const progress = new Map<string, Set<string>>();
for (const item of base.content.items) progress.set(item.key, new Set(["__item__", ...item.tasks.map((t) => t.key)]));
const { diff, exceptions } = diffRoadmapContent(base.content, rev.content, progress, 1);
const baseKeys = new Set(base.content.items.map((i) => i.key));
const out = {
  baseItems: base.content.items.length,
  revisedItems: rev.content.items.length,
  revisedBlocking: validateRoadmapContent(rev.content).filter((e) => e.severity === "blocking").length,
  unchanged: diff.unchangedCount,
  changedSameKey: diff.changed.map((c) => c.itemKey),
  removed: diff.removed.map((r) => ({ key: r.itemKey, progressFlagged: r.hasProgress })),
  added: diff.added.map((a) => ({ key: a.itemKey, collidesWithBaseKey: baseKeys.has(a.itemKey), inheritsProgress: progress.has(a.itemKey) })),
  exceptionsForRemovedWithProgress: exceptions.filter((e) => diff.removed.some((r) => r.itemKey === e.ref.itemKey)).map((e) => `${e.code}:${e.severity}`),
  milestonesChanged: diff.milestonesChanged,
  progressKeptOnUnchanged: base.content.items.filter((i) => !diff.removed.some((r) => r.itemKey === i.key) && !diff.changed.some((c) => c.itemKey === i.key)).length,
};
console.log(JSON.stringify(out, null, 2));
