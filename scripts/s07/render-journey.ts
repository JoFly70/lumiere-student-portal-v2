/**
 * S07 acceptance journey — screenshots, axe-core and horizontal-overflow audit.
 *
 *   npx tsx scripts/s07/render-journey.ts                 # render from the saved journey JSON
 *   S07_RUN_JOURNEY=1 npx tsx scripts/s07/render-journey.ts   # re-run the journey on the local Postgres harness first
 *
 * The JSON in docs/recovery/s07-evidence/journey/ is written by
 * tests/s07-acceptance-journey.test.ts from REAL service/HTTP output (disposable
 * local Postgres, real importer, projection and canonical degree-progress
 * loader). This script only renders it: Vite dev server + Playwright/Chromium,
 * auth, the app shell and every /api call stubbed with that captured JSON,
 * external fonts blocked. These are renders of captured data, not of a deployment.
 *
 * Output: docs/recovery/s07-evidence/journey/screens/*.png, axe-summary.json,
 * overflow-audit.json (in that directory).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const J = path.join(ROOT, "docs/recovery/s07-evidence/journey");
const SCREENS = path.join(J, "screens");
const PORT = Number(process.env.S07_JOURNEY_PORT ?? 5217);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

/* eslint-disable @typescript-eslint/no-explicit-any */
const load = (f: string): any => JSON.parse(fs.readFileSync(path.join(J, f), "utf8"));

function startVite(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "localhost"], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 60_000);
    child.stdout!.on("data", (d) => {
      if (String(d).includes("Local")) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr!.on("data", (d) => process.stderr.write(d));
    child.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}

interface Screen {
  file: string;
  kind: "student" | "staff";
  route: string;
  width: number;
  height: number;
  theme: "light" | "dark";
  ready: string;
  view?: any; // student roadmap view
  adminState?: any;
  preview?: any;
  clickPreview?: boolean;
  expandTasks?: boolean;
  /** Extra element captures (the full-page capture is capped at 6000px, and these cards sit below the exception list). */
  cards?: { suffix: string; title: string }[];
}

async function newPage(browser: any, s: Screen, studentId: string, degreeProgress: any) {
  const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { (globalThis as any).__name = (f: unknown) => f; });
  await ctx.addInitScript(
    ([theme, kind]: [string, string]) => {
      localStorage.setItem("theme", theme);
      localStorage.setItem(
        "lumiere_auth",
        JSON.stringify({
          user: kind === "staff"
            ? { id: "u-admin", email: "admin@synthetic.example", name: "Synthetic Admin", role: "admin" }
            : { id: "u1", email: "eph.journey@synthetic.example", name: "EPH Journey", role: "student" },
          session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
        }),
      );
    },
    [s.theme, s.kind] as [string, string],
  );
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/students/me") return json(200, { id: studentId, first_name: "EPH", last_name: "Journey", email: "eph.journey@synthetic.example", photo_url: null });
    if (url.pathname === "/api/student/roadmap") return json(200, s.view);
    if (url.pathname === "/api/student/degree-progress") return json(200, degreeProgress);
    if (url.pathname.endsWith("/roadmap/draft/preview")) return json(200, s.preview);
    if (url.pathname.endsWith(`/students/${studentId}/roadmap`)) return json(200, s.adminState);
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  return { page, ctx };
}

async function expandTasks(page: any) {
  const toggles = page.locator('[data-testid="item-toggle"]');
  const n = await toggles.count();
  let opened = 0;
  for (let i = 0; i < n && opened < 2; i++) {
    const t = toggles.nth(i);
    if ((await t.isVisible()) && (await t.getAttribute("aria-expanded")) === "false") {
      await t.click();
      opened++;
    }
  }
}

/** Page-level and card-level horizontal overflow, in px (0 = none). */
async function overflowOf(page: any): Promise<{ pageOverflowPx: number; mainOverflowPx: number; spills: string[] }> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main") as HTMLElement | null;
    const spills: string[] = [];
    const scope: ParentNode = main ?? document.body;
    scope.querySelectorAll("article, section, [data-testid='focus-item']").forEach((card) => {
      const cr = (card as HTMLElement).getBoundingClientRect();
      card.querySelectorAll("*").forEach((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || (el as HTMLElement).closest("[hidden]")) return;
        if (r.right > cr.right + 1 && spills.length < 6) spills.push(`${el.tagName}.${String((el as HTMLElement).className).slice(0, 40)} +${Math.round(r.right - cr.right)}px`);
      });
    });
    return {
      pageOverflowPx: Math.max(0, doc.scrollWidth - doc.clientWidth),
      mainOverflowPx: main ? Math.max(0, main.scrollWidth - main.clientWidth) : 0,
      spills,
    };
  });
}

async function runAxe(page: any) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const res = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((v: any) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      sample: v.nodes.slice(0, 3).map((n: any) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(0, 3).join(" ") })),
    }));
  });
}

async function main() {
  if (process.env.S07_RUN_JOURNEY) {
    const r = spawnSync("npx", ["vitest", "run", "tests/s07-acceptance-journey.test.ts"], { cwd: ROOT, stdio: "inherit" });
    if (r.status !== 0) throw new Error("journey test failed");
  }
  fs.mkdirSync(SCREENS, { recursive: true });
  for (const f of fs.readdirSync(SCREENS)) if (f.endsWith(".png")) fs.rmSync(path.join(SCREENS, f));

  const v1Draft = load("02-v1-draft-state.json");
  const v2Draft = load("10-v2-draft-state.json");
  const preview = load("05-v1-staff-preview.json");
  const published = load("07-student-view-published.json");
  const afterProgress = load("09-student-view-after-progress.json");
  const v2View = load("12-student-view-v2.json");
  const rutView = load("08-rut-student-view.json");
  const degreeProgress = load("07b-student-degree-progress.json");
  const studentId: string = v1Draft.studentId;

  const fd = '[data-testid="flight-deck"]';
  const rm = '[data-testid="roadmap-page"]';
  const screens: Screen[] = [];
  const staff = (file: string, width: number, height: number, state: any, extra: Partial<Screen> = {}) =>
    screens.push({ file, kind: "staff", route: `/admin/students/${studentId}/roadmap`, width, height, theme: "light", ready: "text=Current published version", adminState: state, ...extra });
  const HIST = [{ suffix: "reported-history", title: "Reported history (not credit)" }];
  staff("a1-staff-v1-draft-review-1440.png", 1440, 900, v1Draft, { cards: HIST });
  staff("a2-staff-v1-draft-review-390.png", 390, 844, v1Draft, { cards: HIST });
  staff("b-staff-v2-reimport-diff-1440.png", 1440, 900, v2Draft, { cards: [{ suffix: "diff-card", title: "Changes compared with the published plan" }] });
  staff("c-staff-v1-student-preview-1440.png", 1440, 900, v1Draft, { preview, clickPreview: true });

  const stud = (base: string, route: string, sel: string, view: any, widths = [1440, 390], themes: ("light" | "dark")[] = ["light", "dark"]) => {
    for (const theme of themes)
      for (const width of widths)
        screens.push({ file: `${base}-${width}-${theme}.png`, kind: "student", route, width, height: width === 390 ? 844 : 900, theme, ready: sel, view, expandTasks: route === "/roadmap" });
  };
  stud("d1-flight-deck-published", "/flight-deck", fd, published);
  stud("d2-roadmap-published", "/roadmap", rm, published);
  stud("d3-flight-deck-after-progress", "/flight-deck", fd, afterProgress);
  stud("d4-roadmap-after-progress", "/roadmap", rm, afterProgress);
  stud("e-roadmap-v2", "/roadmap", rm, v2View, [1440, 390], ["light"]);
  stud("f-rut-roadmap-sophia-studycom-tasks", "/roadmap", rm, rutView, [1440], ["light"]);

  const vite = await startVite();
  const browser = await chromium.launch();
  const axeResults: any[] = [];
  const overflowResults: any[] = [];
  try {
    for (const s of screens) {
      const { page, ctx } = await newPage(browser, s, studentId, degreeProgress);
      await page.goto(BASE + s.route);
      await page.waitForSelector(s.ready, { timeout: 30_000 });
      if (s.clickPreview) {
        await page.getByRole("button", { name: "Preview as student" }).click();
        await page.waitForSelector("text=what the student would see", { timeout: 10_000 });
      }
      await page.evaluate(() => (document as any).fonts?.ready);
      await page.waitForTimeout(400);
      if (s.expandTasks) await expandTasks(page);
      await page.waitForTimeout(200);
      // overflow + axe at the screen's own width, before the tall-viewport capture
      const overflow = await overflowOf(page);
      overflowResults.push({ screen: s.file, width: s.width, theme: s.theme, ...overflow, ok: overflow.pageOverflowPx === 0 && overflow.mainOverflowPx === 0 && overflow.spills.length === 0 });
      const violations = await runAxe(page);
      axeResults.push({ screen: s.file, width: s.width, theme: s.theme, violationCount: violations.length, violations });
      const h = await page.evaluate(() => {
        const main = document.querySelector("main") as HTMLElement | null;
        return Math.max(document.body.scrollHeight, (main?.scrollHeight ?? 0) + 150);
      });
      await page.setViewportSize({ width: s.width, height: Math.min(Math.max(h, s.height), 6000) });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(SCREENS, s.file) });
      for (const c of s.cards ?? []) {
        const card = page.getByText(c.title, { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded")][1]');
        await card.scrollIntoViewIfNeeded();
        const name = s.file.replace(/\.png$/, `-${c.suffix}.png`);
        await card.screenshot({ path: path.join(SCREENS, name) });
        console.log("wrote", name);
      }
      console.log(s.file, "overflow", overflow.pageOverflowPx, overflow.mainOverflowPx, overflow.spills.length, "axe", violations.map((v: any) => `${v.id}(${v.impact})x${v.nodes}`).join(", ") || "clean");
      await ctx.close();
    }
    fs.writeFileSync(
      path.join(J, "axe-summary.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), rules: "wcag2a, wcag2aa, wcag21aa, best-practice (axe-core)", screensChecked: axeResults.length, screensWithViolations: axeResults.filter((r) => r.violationCount > 0).length, results: axeResults }, null, 2) + "\n",
    );
    fs.writeFileSync(
      path.join(J, "overflow-audit.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), screensChecked: overflowResults.length, screensWithOverflow: overflowResults.filter((r) => !r.ok).length, results: overflowResults }, null, 2) + "\n",
    );
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
