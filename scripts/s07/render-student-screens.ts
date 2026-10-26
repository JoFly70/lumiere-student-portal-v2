/**
 * S07 evidence: renders the real student Flight Deck and Roadmap pages (with the
 * student app shell) in Chromium from fixture data and from views built by the
 * REAL converter and projection, and writes PNGs, an axe-core summary, a
 * horizontal-overflow audit and a mobile interaction audit to
 * docs/recovery/s07-evidence/student-ui/.
 *
 *   npx tsx scripts/s05/build-real-projection-views.ts docs/recovery/s07-evidence/student-ui/real-projection
 *   npx tsx scripts/s07/render-student-screens.ts
 *
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
const OUT = process.env.S07_SCREENS_OUT
  ? path.resolve(process.env.S07_SCREENS_OUT)
  : path.join(ROOT, "docs/recovery/s07-evidence/student-ui");
const PORT = Number(process.env.S07_PORT ?? 5207);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

const rich: any = RICH_MID_JOURNEY;
const realFile = path.join(OUT, "real-projection/scenario-r-view.json");
const realView: any = fs.existsSync(realFile) ? JSON.parse(fs.readFileSync(realFile, "utf8")) : null;

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
  await ctx.addInitScript(() => { (globalThis as any).__name = (f: unknown) => f; });
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
    return { h: main ? main.scrollHeight + 150 : document.body.scrollHeight };
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
    const res = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
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
    const fd = '[data-testid="flight-deck"]';
    const rm = '[data-testid="roadmap-page"]';
    const scenarios: { file: string; route: string; o: Opts; sel: string; axe?: boolean }[] = [
      { file: "01-flight-deck-1440-light.png", route: "/flight-deck", o: { theme: "light", width: 1440, height: 900 }, sel: fd, axe: true },
      { file: "02-flight-deck-390-light.png", route: "/flight-deck", o: { theme: "light", width: 390, height: 844 }, sel: fd, axe: true },
      { file: "03-flight-deck-1440-dark.png", route: "/flight-deck", o: { theme: "dark", width: 1440, height: 900 }, sel: fd, axe: true },
      { file: "04-flight-deck-390-dark.png", route: "/flight-deck", o: { theme: "dark", width: 390, height: 844 }, sel: fd, axe: true },
      { file: "05-roadmap-1440-light.png", route: "/roadmap", o: { theme: "light", width: 1440, height: 900 }, sel: rm, axe: true },
      { file: "06-roadmap-390-light.png", route: "/roadmap", o: { theme: "light", width: 390, height: 844 }, sel: rm, axe: true },
      { file: "07-roadmap-1440-dark.png", route: "/roadmap", o: { theme: "dark", width: 1440, height: 900 }, sel: rm, axe: true },
      { file: "08-roadmap-390-dark.png", route: "/roadmap", o: { theme: "dark", width: 390, height: 844 }, sel: rm, axe: true },
      { file: "09-flight-deck-not-published-1440.png", route: "/flight-deck", o: { theme: "light", width: 1440, height: 900, fixture: NOT_PUBLISHED }, sel: fd, axe: true },
      { file: "10-roadmap-not-published-390.png", route: "/roadmap", o: { theme: "light", width: 390, height: 844, fixture: NOT_PUBLISHED }, sel: rm, axe: true },
    ];
    if (realView) {
      scenarios.push(
        { file: "12-real-projection-flight-deck-1440-light.png", route: "/flight-deck", o: { theme: "light", width: 1440, height: 900, fixture: realView }, sel: fd, axe: true },
        { file: "13-real-projection-roadmap-390-light.png", route: "/roadmap", o: { theme: "light", width: 390, height: 844, fixture: realView }, sel: rm, axe: true },
        { file: "14-real-projection-flight-deck-390-dark.png", route: "/flight-deck", o: { theme: "dark", width: 390, height: 844, fixture: realView }, sel: fd, axe: true },
      );
    }
    for (const s of scenarios) {
      const { page, ctx } = await newPage(browser, s.o);
      await page.goto(BASE + s.route);
      await settle(page, s.sel);
      if (s.file.startsWith("05") || s.file.startsWith("06") || s.file.startsWith("07") || s.file.startsWith("08")) await openTasks(page);
      await shot(page, s.file);
      if (s.axe) await runAxe(page, s.file, axeResults);
      await ctx.close();
    }

    // Mobile task interaction: report a task, then check the toast and the bottom bar cover nothing.
    const interaction: any = {};
    {
      const { page, ctx } = await newPage(browser, { theme: "light", width: 390, height: 844 });
      await page.goto(BASE + "/roadmap");
      await settle(page, rm);
      const jump = page.locator('[data-testid="now-jump"]');
      if (await jump.count()) {
        await jump.click();
        await page.waitForTimeout(900);
      }
      const card = page.locator("article[data-item-key]:has(select:visible)").first();
      await card.waitFor({ timeout: 10_000 });
      const menu = card.locator("select:not([disabled])").first();
      await menu.scrollIntoViewIfNeeded();
      const menuId = await menu.getAttribute("data-testid");
      await menu.selectOption("graded");
      await page.waitForTimeout(700);
      const rects = await page.evaluate((changedId: string | null) => {
        const r = (el: Element | null) => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
        };
        const changed = changedId ? document.querySelector(`[data-testid="${changedId}"]`) : null;
        return {
          viewportHeight: innerHeight,
          toast: r(document.querySelector('[data-testid="save-toast"]')),
          bottomNav: r(document.querySelector('[data-testid="student-bottom-nav"]')),
          changedControl: r(changed),
        };
      }, menuId);
      interaction.afterSave = rects;
      await page.screenshot({ path: path.join(OUT, "11-roadmap-390-task-interaction.png") });
      console.log("wrote 11-roadmap-390-task-interaction.png");
      await runAxe(page, "11-roadmap-390-task-interaction.png", axeResults);

      // Scroll to the very end: the last content must end above the bottom bar.
      await page.evaluate(() => {
        const m = document.querySelector("main") as HTMLElement;
        m.scrollTop = m.scrollHeight;
      });
      await page.waitForTimeout(400);
      interaction.atPageEnd = await page.evaluate(() => {
        const nav = document.querySelector('[data-testid="student-bottom-nav"]')!.getBoundingClientRect();
        const end = document.querySelector('[data-testid="journey-end"]')!.getBoundingClientRect();
        return { journeyEndBottom: Math.round(end.bottom), bottomNavTop: Math.round(nav.top), contentClearOfBar: end.bottom <= nav.top };
      });
      await page.screenshot({ path: path.join(OUT, "15-roadmap-390-page-end.png") });

      // The mobile navigation menu ("More").
      await page.locator('[data-testid="bar-more"]').click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(OUT, "16-mobile-menu-390.png") });
      interaction.logoutControlsVisible = await page.locator('[data-testid="button-logout"]:visible').count();
      await ctx.close();
    }
    {
      const { page, ctx } = await newPage(browser, { theme: "light", width: 1440, height: 900 });
      await page.goto(BASE + "/flight-deck");
      await settle(page, fd);
      interaction.desktopLogoutControls = await page.locator('[data-testid="button-logout"]:visible, button[title="Logout"]:visible').count();
      await page.screenshot({ path: path.join(OUT, "17-flight-deck-1440-viewport-light.png") });
      await ctx.close();
    }
    {
      const { page, ctx } = await newPage(browser, { theme: "dark", width: 1440, height: 900 });
      await page.goto(BASE + "/flight-deck");
      await settle(page, fd);
      await page.screenshot({ path: path.join(OUT, "18-flight-deck-1440-viewport-dark.png") });
      await ctx.close();
    }
    fs.writeFileSync(path.join(OUT, "mobile-interaction-audit.json"), JSON.stringify(interaction, null, 2));

    // Layout audit: nothing may spill out of its card or the viewport at any width.
    const audit: any[] = [];
    for (const width of [1440, 1024, 768, 390]) {
      for (const route of ["/flight-deck", "/roadmap"]) {
        const { page, ctx } = await newPage(browser, { theme: "light", width, height: 900 });
        await page.goto(BASE + route);
        await settle(page, route === "/roadmap" ? rm : fd);
        for (const sel of ['[data-testid="item-toggle"]', '[data-testid="phase-toggle"]', '[data-testid="done-tasks"] button']) {
          const loc = page.locator(sel);
          const n = await loc.count();
          for (let i = 0; i < n; i++) {
            const el = loc.nth(i);
            if ((await el.getAttribute("aria-expanded")) === "false") await el.click({ force: true }).catch(() => {});
          }
        }
        await page.waitForTimeout(300);
        const res = await page.evaluate(() => {
          const out: string[] = [];
          const doc = document.documentElement;
          const main = document.querySelector("main") as HTMLElement;
          if (main.scrollWidth > main.clientWidth + 1) out.push(`main scrolls horizontally: ${main.scrollWidth} > ${main.clientWidth}`);
          if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page scrolls horizontally`);
          main.querySelectorAll("article, [data-testid='focus-item'], section").forEach((card) => {
            const cr = (card as HTMLElement).getBoundingClientRect();
            card.querySelectorAll("*").forEach((el) => {
              const r = (el as HTMLElement).getBoundingClientRect();
              if (r.width === 0 || (el as HTMLElement).closest("[hidden]")) return;
              if (r.right > cr.right + 1 && out.length < 8) out.push(`${(el as HTMLElement).tagName}.${String((el as HTMLElement).className).slice(0, 40)} spills ${Math.round(r.right - cr.right)}px`);
            });
          });
          return out;
        });
        audit.push({ width, route, problems: res });
        console.log("layout", width, route, res.length ? res.join(" | ") : "ok");
        await ctx.close();
      }
    }
    fs.writeFileSync(path.join(OUT, "overflow-audit.json"), JSON.stringify(audit, null, 2));
    fs.writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), fixture: "built-in rich fixture + real-projection scenario R", results: axeResults }, null, 2));
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
