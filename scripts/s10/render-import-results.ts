/**
 * Renders de-identified markdown from the *.summary.json files written by
 * run-original-import.ts.   npx tsx scripts/s10/render-import-results.ts DIR "Heading"
 * Only sha256, sheet names, counts and issue codes are emitted — no cell text.
 */
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const heading = process.argv[3] ?? "Import results";
if (!dir) {
  console.error("usage: DIR [heading]");
  process.exit(2);
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".summary.json")).sort();
const lines: string[] = [`## ${heading}`, ""];
for (const f of files) {
  const s: any = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  lines.push(`### Run \`${s.label}\``, "");
  for (const file of s.files) {
    lines.push(`- ${file.role}: sha256 \`${file.sha256}\`, ${file.bytes} bytes, **original bytes processed: yes**; sheets (${file.sheets.length}): ${file.sheets.length ? file.sheets.map((n: string) => `\`${n}\``).join(", ") : "none readable"}`);
  }
  lines.push(`- adapter / template id: \`${s.templateId}\``);
  if (s.readError.length) lines.push(`- **reader error**: ${s.readError.map((e: string) => `\`${e}\``).join("; ")}`);
  lines.push(`- sheets read by an adapter: ${s.sheetsRead.length ? s.sheetsRead.map((n: string) => `\`${n}\``).join(", ") : "none"}`);
  lines.push(`- sheets IGNORED: ${s.sheetsIgnored.length ? s.sheetsIgnored.map((n: string) => `\`${n}\``).join(", ") : "none"}`);
  lines.push(`- rows: read ${s.rows.read}, converted ${s.rows.converted}, skipped ${s.rows.skipped}`);
  if (s.counts) {
    const c = s.counts;
    lines.push(
      `- content: ${c.items} items (${Object.entries(c.itemsByStatus).map(([k, v]) => `${k} ${v}`).join(", ")}), ${c.tasks} tasks (${c.tasksDated} dated; ${Object.entries(c.tasksByKind).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}), ${c.milestones} milestones, ${c.phases} phases, ${c.objectives} objectives, ${c.reportedHistory} reported-history entries, ${c.itemsWithPlannedEnd} items with a planned end; providers: ${Object.entries(c.itemsByProvider).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    );
    if (c.schedule) lines.push(`- schedule metadata: weeks ${c.schedule.weeks ?? "none"}, starts ${c.schedule.startsOn ?? "none"}`);
  } else lines.push("- content: **none produced** (nothing importable)");
  lines.push(`- schema valid: ${s.schemaValid}`);
  const e = s.exceptions;
  lines.push(`- review exceptions: ${e.total} (${Object.entries(e.bySeverity).map(([k, v]) => `${k} ${v}`).join(", ")})`);
  lines.push(`- by code: ${Object.entries(e.byCode).map(([k, v]) => `\`${k}\` ${v}`).join(", ") || "none"}`);
  lines.push(`- unmatched execution rows (COMPANION_ROW_UNMATCHED): ${e.unmatchedRows.length}${e.unmatchedRows.length ? " (" + e.unmatchedRows.map((u: any) => `${u.sheet}#${u.row}`).join(", ") + ")" : ""}`);
  lines.push(`- blocking errors: ${e.blocking.length ? e.blocking.map((b: any) => `${b.code} @ ${b.sheet ?? "?"}${b.row ? "#" + b.row : ""}`).join("; ") : "none"}`, "");
}
console.log(lines.join("\n"));
