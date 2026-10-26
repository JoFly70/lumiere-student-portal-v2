/**
 * Renders the REAL staff High School Pathway page in Chromium from synthetic
 * fixture data (tests/helpers/s11-hs-staff-fixtures.ts). Writes PNGs,
 * axe-summary.json and layout-audit.json to docs/recovery/s11-evidence/staff/.
 *
 *   npx tsx scripts/s11/render-staff-screens.ts
 *
 * The app shell auth and every /api call are stubbed; external hosts are
 * blocked. These are renders of fixtures, not of a deployment.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  FIXTURE_DOCS, FIXTURE_TEMPLATES, HS_STUDENT_ID, staffStateEligibilityConfirmed, staffStateEmpty, staffStateGraduate, staffStateGraduationReady, staffStateRich,
} from "../../tests/helpers/s11-hs-staff-fixtures";
import type { StaffHighSchoolState } from "../../shared/high-school-contract";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(process.env.S11_STAFF_OUT ?? path.join(ROOT, "docs/recovery/s11-evidence/staff"));
const PORT = Number(process.env.S11_PORT ?? 5197);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

interface Screen { name: string; tab: string; state: () => StaffHighSchoolState; role?: "admin" | "staff"; theme?: "light" | "dark"; widths?: number[] }

const SCREENS: Screen[] = [
  { name: "01-program", tab: "program", state: staffStateRich },
  { name: "02-program-new-student", tab: "program", state: staffStateEmpty },
  { name: "03-prior-study-claims", tab: "prior", state: staffStateRich },
  { name: "04-roadmap-draft", tab: "roadmap", state: staffStateRich },
  { name: "05-roadmap-staff-publish-disabled", tab: "roadmap", state: staffStateRich, role: "staff", widths: [1440] },
  { name: "06-reviews-results", tab: "results", state: staffStateRich },
  { name: "07-graduation-blockers", tab: "graduation", state: staffStateRich },
  { name: "08-graduation-ready-to-confer", tab: "graduation", state: staffStateEligibilityConfirmed },
  { name: "09-graduate-conferred", tab: "graduation", state: staffStateGraduate },
  { name: "10-guardians", tab: "guardians", state: staffStateRich },
  { name: "11-activity", tab: "activity", state: staffStateRich },
  { name: "12-roadmap-dark", tab: "roadmap", state: staffStateRich, theme: "dark", widths: [1440] },
];
void staffStateGraduationReady;

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

async function newPage(browser: any, s: Screen, width: number) {
  const height = width >= 1000 ? 900 : 844;
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const role = s.role ?? "admin";
  await ctx.addInitScript(([theme, r]: string[]) => {
    localStorage.setItem("theme", theme!);
    localStorage.setItem("lumiere_auth", JSON.stringify({
      user: { id: "u-staff", email: "camille.moreau@synthetic.example", name: "Camille Moreau", role: r },
      session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    }));
  }, [s.theme ?? "light", role]);
  const state = s.state();
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === `/api/admin/students/${HS_STUDENT_ID}/high-school`) return json(200, state);
    if (p === "/api/admin/high-school/templates") return json(200, { templates: FIXTURE_TEMPLATES });
    if (p === `/api/documents/student/${HS_STUDENT_ID}`) return json(200, FIXTURE_DOCS);
    if (p.startsWith("/api/documents")) return json(200, []);
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  return { page, ctx };
}

async function runAxe(page: any) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error axe is injected into the page as a global
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n: any) => ({ target: n.target.join(" "), summary: String(n.failureSummary || "").split("\n").slice(0, 3).join(" ") })) }));
  });
}

async function layoutAudit(page: any) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const main = document.querySelector("main") ?? document.body;
    const offenders = [...main.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !e.closest("[class*='overflow-x-auto']"); })
      .slice(0, 8).map((e) => `${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).slice(0, 40)} right=${Math.round(e.getBoundingClientRect().right)}`);
    const small = [...main.querySelectorAll<HTMLElement>("button, a[href], select, input:not([type=checkbox]), [role=tab]")].filter((e) => {
      const r = e.getBoundingClientRect(); const st = getComputedStyle(e);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && r.height < 32 && !e.closest(".sr-only");
    }).length;
    return { viewportWidth: vw, horizontalOverflowPx: overflow, offenders, interactiveUnder32pxHigh: small };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  const axeSummary: any[] = [];
  const layout: any[] = [];
  try {
    for (const s of SCREENS) {
      for (const width of s.widths ?? [1440, 390]) {
        const { page, ctx } = await newPage(browser, s, width);
        await page.goto(`${BASE}/admin/students/${HS_STUDENT_ID}/high-school?tab=${s.tab}`);
        await page.waitForSelector("h1", { timeout: 25_000 });
        await page.waitForSelector("[role=tabpanel] h2", { timeout: 25_000 });
        await page.evaluate(() => (document as any).fonts?.ready);
        await page.waitForTimeout(500);
        const file = `${s.name}-${width}.png`;
        const h = await page.evaluate(() => Math.max((document.querySelector("main") as HTMLElement | null)?.scrollHeight ?? 0 + 90, document.body.scrollHeight));
        await page.setViewportSize({ width, height: Math.min(Math.max(h + 40, 800), 9000) });
        await page.waitForTimeout(250);
        await page.screenshot({ path: path.join(OUT, file) });
        await page.setViewportSize({ width, height: width >= 1000 ? 900 : 844 });
        const violations = await runAxe(page);
        const audit = await layoutAudit(page);
        axeSummary.push({ screen: file, violationCount: violations.length, seriousOrCritical: violations.filter((v: any) => v.impact === "serious" || v.impact === "critical").length, violations });
        layout.push({ screen: file, ...audit });
        console.log(file, "axe:", violations.map((v: any) => `${v.id}(${v.impact})x${v.nodes}`).join(", ") || "clean", "| overflow px:", audit.horizontalOverflowPx);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
  fs.writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify(axeSummary, null, 2));
  fs.writeFileSync(path.join(OUT, "layout-audit.json"), JSON.stringify(layout, null, 2));
  const bad = axeSummary.filter((a) => a.seriousOrCritical > 0);
  console.log(`axe serious/critical screens: ${bad.length}; overflow screens: ${layout.filter((l) => l.horizontalOverflowPx > 0).length}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
