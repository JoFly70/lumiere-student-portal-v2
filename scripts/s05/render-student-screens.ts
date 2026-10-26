/**
 * Renders the real student Flight Deck and Roadmap pages in Chromium from
 * fixture data and writes PNGs plus an axe-core summary to
 * docs/recovery/s05-evidence/screens/.
 *
 *   npx tsx scripts/s05/render-student-screens.ts
 *   S05_ROADMAP_FIXTURE=/path/view.json npx tsx scripts/s05/render-student-screens.ts
 *
 * S05_ROADMAP_FIXTURE: JSON file holding a StudentRoadmapView (for example one
 * produced by the real server projection). It replaces the built-in "rich"
 * fixture. The NOT_PUBLISHED screens always use the built-in fixture.
 * The app shell, authentication and all /api calls are stubbed; external fonts
 * are blocked. These are renders of fixtures, not of a deployment.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { COMPOSED } from "../../tests/helpers/student-progress-ui-fixtures";
import { NOT_PUBLISHED, RICH_MID_JOURNEY } from "../../tests/helpers/student-roadmap-ui-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s05-evidence/screens");
const PORT = Number(process.env.S05_PORT ?? 5189);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

const rich: any = process.env.S05_ROADMAP_FIXTURE
  ? JSON.parse(fs.readFileSync(process.env.S05_ROADMAP_FIXTURE, "utf8"))
  : RICH_MID_JOURNEY;

function startVite(): Promise<ChildProcess> {
  const child = spawn("npx", ["vite", "--port", String(PORT), "--strictPort", "--host", "localhost"], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
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

/** Applies a progress update to a copy of the view (screens only; not the server projection). */
function applyUpdate(view: any, u: any): any {
  const next = JSON.parse(JSON.stringify(view));
  for (const ph of next.phases) {
    for (const it of ph.items) {
      if (it.key !== u.itemKey) continue;
      if (u.taskKey === null) {
        it.itemStatus = u.status;
        it.itemRevision += 1;
        it.stage = u.status === "provider_complete" ? "provider_complete" : u.status === "in_progress" ? "in_progress" : "not_started";
      } else {
        const t = it.tasks.find((x: any) => x.key === u.taskKey);
        if (t) {
          t.status = u.status;
          t.revision += 1;
          t.updatedAt = new Date().toISOString();
        }
        const c = (s: string) => it.tasks.filter((x: any) => x.status === s).length;
        it.taskCounts = { total: it.tasks.length, graded: c("graded"), submitted: c("submitted"), inProgress: c("in_progress"), notStarted: c("not_started") };
        if (it.stage === "not_started" && u.status !== "not_started") it.stage = "in_progress";
        if (it.taskCounts.total > 0 && it.taskCounts.graded === it.taskCounts.total) it.stage = "graded";
      }
    }
  }
  return next;
}

interface Opts { theme: "light" | "dark"; width: number; height: number; fixture?: any }

async function newPage(browser: any, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  let current = o.fixture ?? rich;
  await ctx.addInitScript((theme: string) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("lumiere_auth", JSON.stringify({
      user: { id: "u1", email: "amelia.hart@example.com", name: "Amelia Hart", role: "student" },
      session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    }));
  }, o.theme);
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/students/me") return json(200, { id: "s1", first_name: "Amelia", last_name: "Hart", email: "amelia.hart@example.com", photo_url: null });
    if (url.pathname === "/api/student/roadmap") return json(200, current);
    if (url.pathname === "/api/student/roadmap/progress") {
      current = applyUpdate(current, JSON.parse(route.request().postData() ?? "{}"));
      return json(200, current);
    }
    if (url.pathname === "/api/student/degree-progress") return json(200, COMPOSED);
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  return { page, ctx };
}

async function settle(page: any, selector: string) {
  await page.waitForSelector(selector, { timeout: 20_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(400);
}

/** Capture the whole scrollable <main>, not just the viewport. */
async function shot(page: any, name: string) {
  const size = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement | null;
    return { h: main ? main.scrollHeight + 70 : document.body.scrollHeight };
  });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(size.h, vp.height), 6000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.setViewportSize(vp);
  console.log("wrote", name);
}

async function openTasks(page: any) {
  // Expand the first two item cards so tasks are visible, and the credits explainer.
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

async function runAxe(page: any, label: string, results: any[]) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // @ts-ignore
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n: any) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(0, 3).join(" ") })) }));
  });
  results.push({ screen: label, violations: r });
  console.log("axe", label, r.map((v: any) => `${v.id}(${v.impact})x${v.nodes}`).join(", ") || "clean");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  const axeResults: any[] = [];
  try {
    const scenarios: { file: string; route: string; o: Opts; sel: string; open?: boolean; axe?: boolean }[] = [
      { file: "01-flight-deck-1440-light.png", route: "/flight-deck", o: { theme: "light", width: 1440, height: 900 }, sel: '[data-testid="flight-deck"]', axe: true },
      { file: "02-flight-deck-390-light.png", route: "/flight-deck", o: { theme: "light", width: 390, height: 844 }, sel: '[data-testid="flight-deck"]' },
      { file: "03-flight-deck-1440-dark.png", route: "/flight-deck", o: { theme: "dark", width: 1440, height: 900 }, sel: '[data-testid="flight-deck"]', axe: true },
      { file: "04-flight-deck-390-dark.png", route: "/flight-deck", o: { theme: "dark", width: 390, height: 844 }, sel: '[data-testid="flight-deck"]' },
      { file: "05-roadmap-1440-light.png", route: "/roadmap", o: { theme: "light", width: 1440, height: 900 }, sel: '[data-testid="roadmap-page"]', open: true, axe: true },
      { file: "06-roadmap-390-light.png", route: "/roadmap", o: { theme: "light", width: 390, height: 844 }, sel: '[data-testid="roadmap-page"]', open: true, axe: true },
      { file: "07-roadmap-1440-dark.png", route: "/roadmap", o: { theme: "dark", width: 1440, height: 900 }, sel: '[data-testid="roadmap-page"]', open: true, axe: true },
      { file: "08-roadmap-390-dark.png", route: "/roadmap", o: { theme: "dark", width: 390, height: 844 }, sel: '[data-testid="roadmap-page"]', open: true, axe: true },
      { file: "09-flight-deck-not-published-1440.png", route: "/flight-deck", o: { theme: "light", width: 1440, height: 900, fixture: NOT_PUBLISHED }, sel: '[data-testid="flight-deck"]', axe: true },
      { file: "10-roadmap-not-published-390.png", route: "/roadmap", o: { theme: "light", width: 390, height: 844, fixture: NOT_PUBLISHED }, sel: '[data-testid="roadmap-page"]', axe: true },
    ];
    for (const s of scenarios) {
      const { page, ctx } = await newPage(browser, s.o);
      await page.goto(BASE + s.route);
      await settle(page, s.sel);
      if (s.open) await openTasks(page);
      if (s.o.width < 500) {
        const over = await page.evaluate(() => {
          const out: string[] = [];
          const vw = document.documentElement.clientWidth;
          const main = document.querySelector("main") as HTMLElement;
          out.push(`main scrollWidth ${main?.scrollWidth} clientWidth ${main?.clientWidth} vw ${vw}`);
          main?.querySelectorAll("*").forEach((el) => { const r = (el as HTMLElement).getBoundingClientRect(); if (r.right > vw + 1 && out.length < 6) out.push(`${el.tagName}.${(el as HTMLElement).className.toString().slice(0, 60)} right=${Math.round(r.right)}`); });
          return out;
        });
        console.log("OVERFLOW", s.file, over.join(" | "));
      }
      await shot(page, s.file);
      if (s.axe) await runAxe(page, s.file, axeResults);
      await ctx.close();
    }

    // Mobile interaction: open an item, tick a challenge, see the saved confirmation and updated counts.
    {
      const { page, ctx } = await newPage(browser, { theme: "light", width: 390, height: 844 });
      await page.goto(BASE + "/roadmap");
      await settle(page, '[data-testid="roadmap-page"]');
      const card = page.locator('article[data-item-key="bba-mkt300"]').first();
      await card.scrollIntoViewIfNeeded();
      await card.locator('[data-testid="item-toggle"]').click();
      await card.locator('[data-testid="task-check-challenge-7"]').click();
      await page.waitForTimeout(700);
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(OUT, "11-roadmap-390-task-interaction.png") });
      console.log("wrote 11-roadmap-390-task-interaction.png");
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), fixture: process.env.S05_ROADMAP_FIXTURE ?? "built-in rich fixture", results: axeResults }, null, 2));
  } finally {
    await browser.close();
    vite.kill("SIGTERM");
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
