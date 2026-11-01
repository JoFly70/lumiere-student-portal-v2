/**
 * S30 Phase B — LOCAL UI SIMULATION of the Academic Data Import Center (vite dev server + Playwright route interception;
 * synthetic data only, nothing reaches a server). Screenshots: admin + staff, 390 / 768 / 1440, light + dark, EN + FR.
 *
 *   npx tsx scripts/s30/render-import-screens.ts <outDir>
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { ImportBatchDetail, ImportRowView } from "../../shared/s30-contract";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = process.argv[2] ?? path.join(ROOT, ".s30-import-shots");
const PORT = Number(process.env.S30_PORT ?? 5284);
const BASE = `http://localhost:${PORT}`;
const NOW = new Date("2026-11-10T15:00:00Z");


const MAP = { student_code: "Student code", course: "Course", task: "Task", progress_status: "Status", score_percent: "Score", credits_reported: "Credits", reported_on: "Date" };
const n = (o: Partial<NonNullable<ImportRowView["normalized"]>>) => ({ studentCode: "SYN-001", course: "English 9", courseKey: "eng-9", task: null, progressStatus: null, percentComplete: null, scorePercent: null, creditsReported: null, reportedOn: "2026-10-01", ...o });
const ROWS: ImportRowView[] = [
  { rowNumber: 2, raw: {}, normalized: n({ task: "Unit 1 exam", progressStatus: "completed", scorePercent: 88, creditsReported: 0.5 }), studentId: "s-a", studentName: "Ada Synthetic", outcome: "valid", diff: "new", issues: [{ code: "completion_needs_review", field: "progress_status", severity: "info" }, { code: "credits_informational", field: "credits_reported", severity: "info" }], previous: null },
  { rowNumber: 3, raw: {}, normalized: n({ task: "Unit 2 exam", progressStatus: "in_progress" }), studentId: "s-a", studentName: "Ada Synthetic", outcome: "valid", diff: "changed", issues: [{ code: "conflicting_value", field: null, severity: "info" }], previous: { progressStatus: "not_started" } },
  { rowNumber: 4, raw: {}, normalized: n({ studentCode: "SYN-002", course: "Chemistry", courseKey: null, progressStatus: "completed", scorePercent: 91 }), studentId: "s-b", studentName: "Ben Example", outcome: "warning", diff: "new", issues: [{ code: "course_not_on_plan", field: "course", severity: "warning" }, { code: "completion_needs_review", field: "progress_status", severity: "info" }], previous: null },
  { rowNumber: 5, raw: {}, normalized: n({ studentCode: "UNKNOWN", scorePercent: 70 }), studentId: null, studentName: null, outcome: "invalid", diff: null, issues: [{ code: "student_not_found", field: "student_code", severity: "error" }], previous: null },
  { rowNumber: 6, raw: {}, normalized: n({ studentCode: "SYN-002", course: null, courseKey: null }), studentId: "s-b", studentName: "Ben Example", outcome: "invalid", diff: null, issues: [{ code: "formula_text", field: "course", severity: "error" }, { code: "course_missing", field: "course", severity: "error" }], previous: null },
  { rowNumber: 7, raw: {}, normalized: n({ task: "Unit 1 exam", progressStatus: "completed", scorePercent: 88 }), studentId: "s-a", studentName: "Ada Synthetic", outcome: "warning", diff: "duplicate_in_file", issues: [{ code: "duplicate_in_file", field: null, severity: "warning" }], previous: null },
];
const BATCH: ImportBatchDetail = {
  id: "11111111-1111-4111-8111-111111111111", status: "validated", sourceKind: "provider_progress", tier: "provider_reported", providerLabel: "Synthetic Provider",
  fileName: "provider-export-october.csv", fileFormat: "csv", fileSha256: "a".repeat(64), fileBytes: 18234, sheetName: null, headers: Object.values(MAP), mapping: MAP, suggestedMapping: MAP, mappingId: null,
  counts: { total: 6, valid: 2, warning: 2, invalid: 2, new: 2, changed: 1, unchanged: 0, duplicateInFile: 1, students: 2, needsReview: 2 },
  uploadedBy: "staff-1", uploadedAt: "2026-11-10T14:20:00.000Z", validatedAt: "2026-11-10T14:21:00.000Z", approvedBy: null, approvedAt: null, committedBy: null, committedAt: null,
  rolledBackBy: null, rolledBackAt: null, rollbackReason: null, duplicateOfBatchId: null, rows: ROWS, rowsTruncated: false,
};
const HISTORY = [
  { ...BATCH, rows: undefined },
  { ...BATCH, id: "22222222-2222-4222-8222-222222222222", status: "committed", fileName: "school-results-sept.xlsx", fileFormat: "xlsx", sourceKind: "school_results", tier: "institution_reported", uploadedAt: "2026-10-02T10:00:00.000Z", committedAt: "2026-10-02T10:10:00.000Z", committedBy: "admin-1" },
  { ...BATCH, id: "33333333-3333-4333-8333-333333333333", status: "rolled_back", fileName: "wrong-export.csv", uploadedAt: "2026-09-20T10:00:00.000Z", rollbackReason: "Wrong export file" },
];

function startVite(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "localhost"], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 60_000);
    child.stdout!.on("data", (d) => { if (String(d).includes("Local")) { clearTimeout(timer); resolve(child); } });
    child.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}

async function shoot(browser: any, o: { role: "admin" | "staff"; width: number; height: number; theme: string; lang: "en" | "fr"; name: string }) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, hasTouch: o.width < 500 });
  const user = { id: `${o.role}-1`, email: `${o.role}@synthetic.example`, name: o.role === "admin" ? "Owner Synthetic" : "Staff Synthetic", role: o.role };
  await ctx.addInitScript(([theme, u, lang]: [string, unknown, string]) => {
    localStorage.setItem("lumiere-portal:theme", theme);
    localStorage.setItem("lumiere_language", lang);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: 4102444800 } }));
  }, [o.theme, user, o.lang] as [string, unknown, string]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.clock.setFixedTime(NOW);
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    const p = url.pathname;
    if (!p.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/admin/imports") return json(200, { batches: HISTORY });
    if (p === "/api/admin/imports/mappings") return json(200, { mappings: [{ id: "m1", name: "Synthetic provider export", sourceKind: "provider_progress", columns: MAP, updatedAt: NOW.toISOString() }] });
    if (p.startsWith("/api/admin/imports/")) return json(200, BATCH);
    if (p === "/api/search") return json(200, { results: [] });
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.goto(`${BASE}/admin/imports?batch=${BATCH.id}`);
  await page.waitForSelector('[data-testid="imp-page"]', { timeout: 30_000 });
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0 && process.env.S30_DEBUG) console.log(await page.evaluate(() => { const vw = document.documentElement.clientWidth; return Array.from(document.querySelectorAll("*")).filter((e) => e.getBoundingClientRect().right > vw + 1).filter((e) => !e.closest('[role="region"]')).slice(0, 12).map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 60)} [${(e as HTMLElement).dataset.testid ?? ""}] r=${Math.round(e.getBoundingClientRect().right)}`).join("\n") + "\nREGIONS " + Array.from(document.querySelectorAll('[role="region"]')).map((r) => `${(r as HTMLElement).getAttribute("aria-label")}:${getComputedStyle(r).overflowX}:${Math.round(r.getBoundingClientRect().right)}:${(r as HTMLElement).scrollWidth}`).join(" | ") + " docSW=" + document.documentElement.scrollWidth + " bodySW=" + document.body.scrollWidth; }));
  const h = await page.evaluate(() => { const m = document.querySelector("main"); return m ? m.scrollHeight + 130 : document.documentElement.scrollHeight; });
  await page.setViewportSize({ width: o.width, height: Math.min(Math.max(o.height, h), 6000) });
  await page.screenshot({ path: path.join(OUT, `${o.name}.png`) });
  await ctx.close();
  return { name: o.name, overflow, errors };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const role of ["admin", "staff"] as const) {
      for (const [w, h] of (process.env.S30_DEBUG ? [[390, 844]] : [[1440, 900], [768, 1024], [390, 844]]) as ReadonlyArray<readonly [number, number]>) {
        for (const theme of ["lumiere", "lumiere-dark"]) results.push(await shoot(browser, { role, width: w, height: h, theme, lang: "en", name: `${role}-${w}-${theme}` }));
      }
      results.push(await shoot(browser, { role, width: 1440, height: 900, theme: "lumiere", lang: "fr", name: `${role}-1440-fr` }));
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { /* gone */ }
  }
  for (const r of results) console.log(`${r.name}: overflow=${r.overflow}px errors=${r.errors.length ? r.errors.join(" | ").slice(0, 200) : 0}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
