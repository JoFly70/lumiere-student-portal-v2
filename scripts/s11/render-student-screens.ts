/**
 * Renders the real student High School Pathway page in Chromium from fixtures.
 * Writes PNGs, axe-summary.json and layout-audit.json to
 * docs/recovery/s11-evidence/student/.
 *
 *   npx tsx scripts/s11/render-student-screens.ts
 *
 * Auth and every /api call are stubbed; external fonts are blocked. These are
 * renders of synthetic fixtures (student "Noa Fischer"), not of a deployment.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { HS_ELIGIBLE, HS_GRADUATED, HS_MID_WAY, HS_NEW_STUDENT } from "../../tests/helpers/s11-hs-ui-fixtures";
import type { StudentHighSchoolView } from "../../shared/high-school-contract";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(process.env.S11_SCREENS_OUT ?? path.join(ROOT, "docs/recovery/s11-evidence/student"));
const PORT = Number(process.env.S11_PORT ?? 5211);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

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

interface Opts { theme: "light" | "dark"; width: number; height: number; view: StudentHighSchoolView | null }

async function newPage(browser: any, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([theme]: string[]) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("lumiere_auth", JSON.stringify({
      user: { id: "u1", email: "noa.fischer@synthetic.example", name: "Noa Fischer", role: "student" },
      session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    }));
  }, [o.theme]);
  // tsx/esbuild wraps named functions in __name(); page.evaluate bodies need it defined in the page.
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === "/api/student/high-school") {
      return o.view ? json(200, o.view) : json(404, { error: { code: "HS_NO_ENROLLMENT", message: "No high school enrollment" } });
    }
    if (p === "/api/students/me") return json(200, { id: "s1", first_name: "Noa", last_name: "Fischer", email: "noa.fischer@synthetic.example", photo_url: null });
    if (p.startsWith("/api/documents")) return json(200, []);
    if (p.startsWith("/api/tickets")) return json(200, { tickets: [], pagination: { total: 0, limit: 100, offset: 0 } });
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  return { page, ctx };
}

async function settle(page: any, selector: string) {
  await page.waitForSelector(selector, { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
}

async function shot(page: any, name: string) {
  const h = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement | null;
    return Math.max(main ? main.scrollHeight + 90 : 0, document.body.scrollHeight);
  });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 7000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.setViewportSize(vp);
  console.log("wrote", name);
}

async function runAxe(page: any, label: string, results: any[]) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // @ts-expect-error axe is injected into the page as a global
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n: any) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(0, 3).join(" ") })) }));
  });
  results.push({ screen: label, violationCount: r.length, seriousOrCritical: r.filter((v: any) => v.impact === "serious" || v.impact === "critical").length, violations: r });
  console.log("axe", label, r.map((v: any) => `${v.id}(${v.impact})x${v.nodes}`).join(", ") || "clean");
}

type Scene = "journey" | "subjects" | "graduation" | "no-enrollment" | "graduated" | "eligible";
const READY = '[data-testid="hs-header"], [data-testid="hs-no-enrollment"]';

async function prepare(page: any, scene: Scene) {
  await page.goto(BASE + "/high-school");
  await settle(page, READY);
  if (scene === "subjects") {
    await page.click('[data-testid="tab-subjects"]');
    // English (the current course's subject) is open by default; open the English 3 course with tasks and controls, then Mathematics.
    const eng = page.locator('[data-subject="english"] [data-testid="subject-toggle"]');
    if ((await eng.getAttribute("aria-expanded")) !== "true") await eng.click();
    await page.locator('[data-course-key="english-3"] button[aria-expanded]').click();
    await page.locator('[data-subject="mathematics"] [data-testid="subject-toggle"]').click();
    await page.waitForTimeout(300);
  } else if (scene === "graduation" || scene === "graduated" || scene === "eligible") {
    await page.click('[data-testid="tab-graduation"]');
    await page.waitForTimeout(300);
  }
}

function fixtureFor(scene: Scene): StudentHighSchoolView | null {
  if (scene === "no-enrollment") return null;
  if (scene === "graduated") return HS_GRADUATED;
  if (scene === "eligible") return HS_ELIGIBLE;
  return HS_MID_WAY;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  const axeResults: any[] = [];
  const audit: any[] = [];
  const scenes: Scene[] = ["journey", "subjects", "graduation", "no-enrollment", "graduated"];
  try {
    let n = 1;
    for (const scene of scenes) {
      for (const [theme, width, height] of [["light", 1440, 900], ["light", 390, 844], ["dark", 1440, 900], ["dark", 390, 844]] as const) {
        const { page, ctx } = await newPage(browser, { theme, width, height, view: fixtureFor(scene) });
        await prepare(page, scene);
        const file = `${String(n).padStart(2, "0")}-${scene}-${width}-${theme}.png`;
        await shot(page, file);
        await runAxe(page, file, axeResults);
        await ctx.close();
        n++;
      }
    }

    // Extra states: a brand-new student and the 390px journey with the first screen only.
    {
      const { page, ctx } = await newPage(browser, { theme: "light", width: 390, height: 844, view: HS_NEW_STUDENT });
      await prepare(page, "journey");
      await shot(page, `${String(n++).padStart(2, "0")}-new-student-390-light.png`);
      await runAxe(page, "new-student-390-light", axeResults);
      await page.screenshot({ path: path.join(OUT, "first-screen-journey-390-light.png") });
      await ctx.close();
    }

    // Layout audit: overflow (page, main AND inside containers) at four widths, touch targets at 390,
    // contrast of every visible control (disabled ones included, which axe skips) in light and dark.
    const auditScenes: Scene[] = [...scenes, "eligible"];
    const journeyHeights: Record<string, number> = {};
    for (const scene of auditScenes) {
      for (const [theme, width] of [["light", 1440], ["light", 1024], ["light", 768], ["light", 390], ["dark", 1440], ["dark", 390]] as const) {
        const { page, ctx } = await newPage(browser, { theme, width, height: 900, view: fixtureFor(scene) });
        await prepare(page, scene);
        if (scene === "eligible" && width === 390 && theme === "light") {
          await shot(page, "22-graduation-eligible-390-light.png");
          await runAxe(page, "22-graduation-eligible-390-light.png", axeResults);
        }
        if (scene === "journey" && theme === "light") journeyHeights[String(width)] = await page.evaluate(() => (document.querySelector("#hs-panel-journey") as HTMLElement).getBoundingClientRect().height);
        const res = await page.evaluate((w: number) => {
          const out: string[] = [];
          const doc = document.documentElement;
          if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page scrolls horizontally: ${doc.scrollWidth} > ${doc.clientWidth}`);
          const main = document.querySelector("main") as HTMLElement | null;
          if (main && main.scrollWidth > main.clientWidth + 1) out.push(`main scrolls horizontally: ${main.scrollWidth} > ${main.clientWidth}`);
          const small: string[] = [];
          if (w <= 480) {
            const sel = 'a[href], button, input, select, textarea, [role="tab"]';
            for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
              const r = el.getBoundingClientRect();
              const st = getComputedStyle(el);
              if (r.width === 0 || r.height === 0 || st.visibility === "hidden" || el.closest("[hidden]") || el.closest(".sr-only")) continue;
              if (el.closest("aside, nav, header[class*='sticky']")) continue; // shell navigation belongs to S10
              if (r.height < 43.5) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
          // Overflow INSIDE containers: content wider than its box where the box does not scroll on purpose.
          for (const el of Array.from(document.querySelectorAll<HTMLElement>("main *"))) {
            if (el.closest("[hidden], .sr-only") || el instanceof SVGElement) continue;
            const st = getComputedStyle(el);
            if (st.display === "inline" || st.display === "contents" || st.display === "none") continue;
            if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && st.overflowX !== "auto" && st.overflowX !== "scroll") {
              out.push(`inner overflow ${el.scrollWidth}>${el.clientWidth} in <${el.tagName.toLowerCase()} ${(el.getAttribute("data-testid") || el.className.toString().slice(0, 40))}>`);
            }
          }
          // Contrast (WCAG) of visible controls, including disabled ones, with opacity folded in.
          const parse = (c: string): number[] => (c.match(/[\d.]+/g) ?? []).map(Number);
          const lum = (r: number, g: number, b: number) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
          const lowContrast: string[] = [];
          const controls = 'a[href], button, [role="tab"], summary, select, input';
          for (const el of Array.from(document.querySelectorAll<HTMLElement>(controls))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || el.closest("[hidden], .sr-only, aside, nav")) continue;
            let opacity = 1;
            let bg = [255, 255, 255];
            const stack: number[][] = [];
            for (let n: HTMLElement | null = el; n; n = n.parentElement) {
              const st = getComputedStyle(n);
              opacity *= Number(st.opacity);
              const p = parse(st.backgroundColor);
              if (p.length >= 3 && (p[3] ?? 1) > 0) stack.push(p);
              if (p.length >= 3 && (p[3] ?? 1) >= 1) break;
            }
            for (const p of stack.reverse()) { const a = p[3] ?? 1; bg = [0, 1, 2].map((i) => p[i] * a + bg[i] * (1 - a)); }
            const fgp = parse(getComputedStyle(el).color);
            const a = (fgp[3] ?? 1) * opacity;
            const fg = [0, 1, 2].map((i) => fgp[i] * a + bg[i] * (1 - a));
            const l1 = lum(fg[0], fg[1], fg[2]), l2 = lum(bg[0], bg[1], bg[2]);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            if (ratio < 4.5 && (el.textContent ?? "").trim() !== "" && getComputedStyle(el).backgroundImage === "none") {
              lowContrast.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}" ${ratio.toFixed(2)}:1${(el as HTMLButtonElement).disabled ? " (disabled)" : ""}`);
            }
          }
          return { overflow: out, smallTargets: small, lowContrast };
        }, width);
        audit.push({ scene, theme, width, overflow: res.overflow.length > 0, problems: res.overflow, smallTargets: res.smallTargets, lowContrast: res.lowContrast });
        console.log("layout", scene, theme, width, res.overflow.length ? res.overflow.join(" | ") : "ok", res.smallTargets.length ? `small targets: ${res.smallTargets.length}` : "", res.lowContrast.length ? `LOW CONTRAST: ${res.lowContrast.join("; ")}` : "");
        await ctx.close();
      }
    }
    fs.writeFileSync(path.join(OUT, "layout-audit.json"), JSON.stringify({ journeyHeightPx: journeyHeights, entries: audit }, null, 2));
    console.log("journey heights", JSON.stringify(journeyHeights));

    const total = axeResults.reduce((s, r) => s + (r.violationCount ?? 0), 0);
    const serious = axeResults.reduce((s, r) => s + (r.seriousOrCritical ?? 0), 0);
    fs.writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), fixtures: "tests/helpers/s11-hs-ui-fixtures.ts", totalViolations: total, seriousOrCritical: serious, results: axeResults }, null, 2));
    console.log(`axe total=${total} seriousOrCritical=${serious}`);
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
