/**
 * Visual evidence of the Excel-first staff workflow, from REAL server output.
 *
 *   npx tsx scripts/s05/render-staff-workflow.ts
 *
 * Phase 1: disposable Postgres + real roadmap service (tests/helpers/s05-roadmap-stack.ts)
 *          run scenario R (v1 -> ack -> publish -> progress -> v2 re-import) and scenario M,
 *          capturing AdminRoadmapState / preview JSON.
 * Phase 2: Vite dev server + Playwright; /api/** is stubbed with the captured JSON
 *          (renders of captured data, not of a deployment). Postgres and Vite are always stopped.
 * Output:  docs/recovery/s05-evidence/staff-workflow/{*.png,*.json}
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { seedAcademicRecord, seedStudent, seedUser, startLocalPg, PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE } from "../../tests/helpers/s05-local-pg";
import { bootRoadmapStack } from "../../tests/helpers/s05-roadmap-stack";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s05-evidence/staff-workflow");
const WB = path.join(ROOT, "tests/fixtures/s05/workbooks");
const PORT = Number(process.env.S05_PORT ?? 5191);
const BASE = `http://localhost:${PORT}`;

const save = (name: string, data: unknown) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));

async function capture() {
  if (!PG_BINARIES_AVAILABLE) throw new Error(S05_PG_SKIP_MESSAGE);
  const pg = await startLocalPg();
  try {
    const stack = await bootRoadmapStack(pg);
    const staff = await seedUser(pg, "staff");
    const admin = await seedUser(pg, "admin");
    const rUser = await seedUser(pg, "student");
    const rStudent = await seedStudent(pg, { userId: rUser.id, firstName: "Dalia", lastName: "Scenario-R" });
    await seedAcademicRecord(pg, rStudent.id, { staffUserId: staff.id });
    const mUser = await seedUser(pg, "student");
    const mStudent = await seedStudent(pg, { userId: mUser.id, firstName: "Mira", lastName: "Scenario-M" });
    await seedAcademicRecord(pg, mStudent.id, { staffUserId: staff.id });
    const { service } = stack;
    const read = (f: string) => fs.readFileSync(path.join(WB, f));

    // Scenario M: import only (review state)
    const mState = await stack.importWorkbook(mStudent.id, staff.id, read("scenario-m-pending-evaluation-conditional.xlsx"), "scenario-m-pending-evaluation-conditional.xlsx");
    save("scenario-m-draft-state.json", mState.state);

    // Scenario R
    const r1 = await stack.importWorkbook(rStudent.id, staff.id, read("scenario-r-intensive.xlsx"), "scenario-r-intensive.xlsx");
    save("scenario-r-v1-draft-state.json", r1.state);
    await stack.ackAll(rStudent.id, staff.id);
    const r1pub = await stack.publishOpenDraft(rStudent.id, admin.id);
    save("scenario-r-v1-published-state.json", r1pub);
    let rev = 0;
    for (const [itemKey, taskKey, status] of [["r-acct-101", "challenge-1", "graded"], ["r-acct-101", "challenge-2", "submitted"], ["r-bus-230", null, "in_progress"]] as const) {
      await service.reportProgress(rStudent.id, rUser.id, { itemKey, taskKey, status, expectedRevision: rev } as never);
      rev = 0;
    }
    const v2 = await stack.importWorkbook(rStudent.id, staff.id, read("scenario-r-intensive-v2-course-replaced.xlsx"), "scenario-r-intensive-v2-course-replaced.xlsx");
    save("scenario-r-v2-draft-state.json", v2.state);
    save("scenario-r-v2-preview.json", await service.previewDraft(rStudent.id));
    await stack.ackAll(rStudent.id, staff.id);
    const r2pub = await stack.publishOpenDraft(rStudent.id, admin.id);
    save("scenario-r-v2-published-state.json", r2pub);
    return { rId: rStudent.id, mId: mStudent.id };
  } finally {
    await pg.stop();
  }
}

function startVite(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "localhost"], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 60_000);
    child.stdout!.on("data", (d) => { if (String(d).includes("Local")) { clearTimeout(timer); resolve(child); } });
    child.stderr!.on("data", (d) => process.stderr.write(d));
    child.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}
const load = (f: string) => JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));

async function render(ids: { rId: string; mId: string }) {
  const { chromium } = require("playwright");
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    const screens: { file: string; width: number; height: number; studentId: string; state: string; preview?: string; clickPreview?: boolean }[] = [];
    for (const [w, h] of [[1440, 900], [390, 844]] as const) {
      screens.push(
        { file: `a-m-draft-review-${w}.png`, width: w, height: h, studentId: ids.mId, state: "scenario-m-draft-state.json" },
        { file: `b-r-v2-reimport-diff-${w}.png`, width: w, height: h, studentId: ids.rId, state: "scenario-r-v2-draft-state.json" },
        { file: `c-r-v2-preview-${w}.png`, width: w, height: h, studentId: ids.rId, state: "scenario-r-v2-draft-state.json", preview: "scenario-r-v2-preview.json", clickPreview: true },
        { file: `d-r-published-history-${w}.png`, width: w, height: h, studentId: ids.rId, state: "scenario-r-v2-published-state.json" },
      );
    }
    for (const s of screens) {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height } });
      await ctx.addInitScript(() => {
        localStorage.setItem("lumiere_auth", JSON.stringify({
          user: { id: "u-admin", email: "admin@synthetic.example", name: "Synthetic Admin", role: "admin" },
          session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
        }));
      });
      const state = load(s.state);
      const preview = s.preview ? load(s.preview) : null;
      await ctx.route(/.*/, async (route: any) => {
        const url = new URL(route.request().url());
        if (url.hostname !== "localhost") return route.abort();
        if (!url.pathname.startsWith("/api/")) return route.continue();
        const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (url.pathname.endsWith("/roadmap/draft/preview")) return json(200, preview);
        if (url.pathname.endsWith(`/students/${s.studentId}/roadmap`)) return json(200, state);
        return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e: Error) => console.error("pageerror:", e.stack?.split("\n").slice(0, 4).join(" | ")));
      await page.goto(`${BASE}/admin/students/${s.studentId}/roadmap`);
      await page.waitForSelector("h1", { timeout: 20_000 });
      await page.waitForSelector("text=Current published version", { timeout: 20_000 });
      if (s.clickPreview) {
        await page.getByRole("button", { name: "Preview as student" }).click();
        await page.waitForSelector("text=what the student would see", { timeout: 10_000 });
      }
      await page.waitForTimeout(400);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 0) {
        const offenders = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth;
          return [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().width > vw - 20 && !!e.closest("main")).slice(-12).map((e) => `${e.tagName}.${String((e as HTMLElement).className).slice(0, 40)}:${(e.textContent||"").slice(0,25)} right=${Math.round(e.getBoundingClientRect().right)}`);
        });
        console.log("  overflow offenders:", offenders.join(" || "));
      }
      const h = await page.evaluate(() => Math.max(document.body.scrollHeight, (document.querySelector("main") as HTMLElement | null)?.scrollHeight ?? 0) + 40);
      await page.setViewportSize({ width: s.width, height: Math.min(Math.max(h, s.height), 7000) });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, s.file) });
      console.log("wrote", s.file, "horizontal overflow px:", overflow);
      await ctx.close();
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // S05_SKIP_CAPTURE=1 re-renders from the JSON already on disk (no Postgres).
  const ids = process.env.S05_SKIP_CAPTURE
    ? { rId: load("scenario-r-v2-draft-state.json").studentId as string, mId: load("scenario-m-draft-state.json").studentId as string }
    : await capture();
  await render(ids);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
