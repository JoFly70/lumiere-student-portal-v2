/**
 * S13 browser verification of the first high-school student release.
 *
 *   npx tsx scripts/s13/render-first-student-screens.ts
 *
 * LOCAL UI SIMULATION: vite dev server + Playwright route interception. Auth and every /api call are stubbed
 * from synthetic fixtures; external hosts are blocked. This is NOT hosted acceptance. It drives real clicks
 * and captures the requests the UI issues. Writes PNGs and browser-results.json to
 * docs/recovery/s13-evidence/screens/.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { HS_MID_WAY, HS_NEW_STUDENT } from "../../tests/helpers/s11-hs-ui-fixtures";
import { FIXTURE_DOCS, FIXTURE_TEMPLATES, HS_STUDENT_ID, staffStateRich } from "../../tests/helpers/s11-hs-staff-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(process.env.S13_SCREENS_OUT ?? path.join(ROOT, "docs/recovery/s13-evidence/screens"));
const PORT = Number(process.env.S13_PORT ?? 5213);
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

interface Req { method: string; path: string; body: any }
type Handler = (req: Req) => { status: number; body: unknown } | null;
interface Opts { role: "student" | "admin" | "staff"; theme: "light" | "dark"; width: number; handler: Handler }

const results: Record<string, { pass: boolean; note: string }> = {};
const axeLog: any[] = [];
const overflowLog: any[] = [];
const rec = (check: string, pass: boolean, note: string) => { results[check] = { pass, note }; console.log(pass ? "PASS" : "FAIL", check, "-", note); };

async function ctxPage(browser: any, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.width >= 1000 ? 900 : 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([theme, role]: string[]) => {
    localStorage.setItem("theme", theme!);
    localStorage.setItem("lumiere_auth", JSON.stringify({
      user: { id: "u1", email: "noa.fischer@synthetic.example", name: "Noa Fischer", role },
      session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    }));
  }, [o.theme, o.role]);
  await ctx.addInitScript("window.__name = (f) => f;");
  const requests: Req[] = [];
  await ctx.route(/.*/, async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let body: any = null;
    try { body = r.postDataJSON(); } catch { body = r.postData(); }
    const req: Req = { method: r.method(), path: url.pathname, body };
    if (r.method() !== "GET") requests.push(req);
    const hit = o.handler(req);
    const res = hit ?? { status: 404, body: { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } } };
    return route.fulfill({ status: res.status, contentType: "application/json", body: JSON.stringify(res.body) });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => { errors.push(e.message); console.error("pageerror:", e.message); });
  return { page, ctx, requests, errors };
}

const ok = (body: unknown) => ({ status: 200, body });
const HS_ONLY_PROGRAMS = { programs: [{ kind: "high_school", id: "e1", title: "Lumière High School Diploma (21 credits)", status: "active", current: true }] };

function studentHandler(view: unknown, extra?: Handler): Handler {
  return (req) => {
    const e = extra?.(req);
    if (e) return e;
    const p = req.path;
    if (p === "/api/student/programs") return ok(HS_ONLY_PROGRAMS);
    if (p === "/api/student/high-school") return view ? ok(view) : { status: 404, body: { error: { code: "HS_NO_ENROLLMENT", message: "No high school enrollment" } } };
    if (p === "/api/students/me") return ok({ id: "s1", first_name: "Noa", last_name: "Fischer", email: "noa.fischer@synthetic.example", photo_url: null });
    if (p.startsWith("/api/documents")) return ok([]);
    if (p.startsWith("/api/tickets")) return ok({ tickets: [], pagination: { total: 0, limit: 100, offset: 0 } });
    return null;
  };
}

async function settle(page: any, selector: string) {
  await page.waitForSelector(selector, { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
}

async function shot(page: any, name: string) {
  const h = await page.evaluate(() => Math.max((document.querySelector("main") as HTMLElement | null)?.scrollHeight ?? 0, 0) + 90);
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 6000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.setViewportSize(vp);
  console.log("wrote", name);
}

async function audit(page: any, label: string, width: number, touchSelectors?: string) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => {
    // @ts-expect-error axe injected
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((x: any) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, sample: x.nodes.slice(0, 2).map((n: any) => n.target.join(" ")) }));
  });
  axeLog.push({ screen: label, violations: v });
  const lay = await page.evaluate(([sel, w]: [string, number]) => {
    const se = document.scrollingElement!;
    const small: string[] = [];
    if (w <= 480) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden" || el.closest(".sr-only,[hidden]")) continue;
        if (r.height < 43.5) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}" ${Math.round(r.height)}px`);
      }
    }
    return { overflow: se.scrollWidth > se.clientWidth, sw: se.scrollWidth, cw: se.clientWidth, small };
  }, [touchSelectors ?? "main a[href], main button, main select, main input, main [role=tab]", width] as [string, number]);
  overflowLog.push({ screen: label, ...lay });
  console.log("  audit", label, "axe:", v.map((x: any) => `${x.id}(${x.impact})x${x.nodes}`).join(", ") || "clean", "| overflow:", lay.overflow, lay.overflow ? `${lay.sw}>${lay.cw}` : "", lay.small.length ? `| small: ${lay.small.join("; ")}` : "");
  return { violations: v, ...lay };
}

async function waitPath(page: any, p: string, ms = 8000) {
  try { await page.waitForFunction((x: string) => location.pathname === x, p, { timeout: ms }); return true; } catch { return false; }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  const issues: string[] = [];
  try {
    // ── 1. high-school-only landing, nav, university-only notice ──────────────────────
    for (const width of [1440, 390]) {
      for (const theme of ["light", "dark"] as const) {
        const { page, ctx, errors } = await ctxPage(browser, { role: "student", theme, width, handler: studentHandler(HS_MID_WAY) });
        const tag = `${width}-${theme}`;
        await page.goto(BASE + "/");
        await settle(page, '[data-testid="hs-header"]');
        const landed = new URL(page.url()).pathname;
        rec(`1.landing-${tag}`, landed === "/high-school", `"/" -> ${landed}`);
        const nav = await page.evaluate((w: number) => {
          const scope = w >= 1000 ? document.querySelector("aside, [data-sidebar='sidebar'], [data-sidebar]") : document.querySelector("nav[aria-label], nav:not([class*='sidebar'])");
          const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).filter((a) => {
            const r = a.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !a.closest("main");
          }).map((a) => ({ href: a.getAttribute("href"), text: (a.textContent || a.getAttribute("aria-label") || "").trim() }));
          return { links, scope: !!scope };
        }, width);
        const hrefs = nav.links.map((l) => l.href);
        const navOk = hrefs.includes("/high-school") && !hrefs.includes("/flight-deck") && !hrefs.includes("/roadmap");
        rec(`1.nav-${tag}`, navOk, `visible non-main links: ${nav.links.map((l) => `${l.text}->${l.href}`).join(", ")}`);
        if (width === 390 || theme === "light") {
          await shot(page, `${width === 1440 ? (theme === "light" ? "01" : "03") : theme === "light" ? "02" : "04"}-hs-only-journey-${tag}.png`);
        }
        const a = await audit(page, `journey-${tag}`, width);
        rec(`6.journey-${tag}`, !a.overflow && a.violations.filter((x: any) => x.impact === "serious" || x.impact === "critical").length === 0, `overflow=${a.overflow}; axe=${a.violations.map((x: any) => `${x.id}(${x.impact})`).join(",") || "clean"}${a.small.length ? `; small targets: ${a.small.join("; ")}` : ""}`);
        if (a.small.length && width === 390) rec(`6.touch-journey-${tag}`, false, a.small.join("; ")); else if (width === 390) rec(`6.touch-journey-${tag}`, true, "all main controls >= 44px");
        rec(`pageerrors-journey-${tag}`, errors.length === 0, errors.join("; ") || "none");
        // /flight-deck notice
        if (theme === "light") {
          await page.goto(BASE + "/flight-deck");
          await settle(page, '[data-testid="university-only-notice"]');
          if (width === 1440 || width === 390) await shot(page, `${width === 1440 ? "05" : "06"}-hs-only-flightdeck-notice-${tag}.png`);
          await page.click('[data-testid="link-go-high-school"]');
          const back = await waitPath(page, "/high-school");
          rec(`1.flightdeck-notice-${tag}`, back, back ? "notice shown; link returns to /high-school" : `stayed at ${new URL(page.url()).pathname}`);
          const a2 = await audit(page, `flightdeck-notice-${tag}`, width);
          if (a2.overflow) rec(`6.flightdeck-notice-overflow-${tag}`, false, "overflow"); 
        }
        await ctx.close();
      }
    }

    // ── 2. interactions on /high-school ───────────────────────────────────────────────
    for (const width of [1440, 390]) {
      const { page, ctx, requests } = await ctxPage(browser, {
        role: "student", theme: "light", width,
        handler: studentHandler(HS_MID_WAY, (req) => (req.method === "POST" && req.path === "/api/student/high-school/progress" ? ok(HS_MID_WAY) : null)),
      });
      const tag = `${width}`;
      await page.goto(BASE + "/high-school");
      await settle(page, '[data-testid="hs-header"]');
      const creditsText = async () => page.evaluate(() => ["credit-ring", "credits-remaining", "credits-reported", "credits-official-note"].map((id) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? "").join("|"));
      const creditsBefore = await creditsText();
      // tabs
      const tabsOk: string[] = [];
      for (const [id, panel] of [["tab-subjects", "#hs-panel-subjects"], ["tab-graduation", "#hs-panel-graduation"], ["tab-journey", "#hs-panel-journey"]] as const) {
        await page.click(`[data-testid="${id}"]`);
        await page.waitForTimeout(250);
        const vis = await page.evaluate((s: string) => { const e = document.querySelector(s) as HTMLElement | null; return !!e && e.getBoundingClientRect().height > 0; }, panel);
        tabsOk.push(`${id}:${vis}`);
        if (id === "tab-graduation" && width === 1440) await shot(page, "07-hs-graduation-1440-light.png");
      }
      rec(`2.tabs-${tag}`, tabsOk.every((t) => t.endsWith("true")), tabsOk.join(" "));
      // help links
      await page.click('[data-testid="tab-journey"]');
      await page.click('[data-testid="help-links"] [data-testid="link-upload-evidence"]');
      const docs = await waitPath(page, "/documents");
      rec(`2.link-documents-${tag}`, docs, docs ? "navigated to /documents" : `at ${new URL(page.url()).pathname}`);
      await page.goto(BASE + "/high-school"); await settle(page, '[data-testid="hs-header"]');
      await page.click('[data-testid="link-ask-help"]');
      const sup = await waitPath(page, "/support");
      rec(`2.link-support-${tag}`, sup, sup ? "navigated to /support" : `at ${new URL(page.url()).pathname}`);
      await page.goto(BASE + "/high-school"); await settle(page, '[data-testid="hs-header"]');
      // open course + task, submit report
      await page.click('[data-testid="tab-subjects"]');
      const eng = page.locator('[data-subject="english"] [data-testid="subject-toggle"]');
      if ((await eng.getAttribute("aria-expanded")) !== "true") await eng.click();
      await page.locator('[data-course-key="english-3"] button[aria-expanded]').click();
      await page.waitForTimeout(300);
      const row = page.locator('[data-course-key="english-3"] [data-testid="task-row"]').first();
      const rowCount = await page.locator('[data-course-key="english-3"] [data-testid="task-row"]').count();
      // find first editable task form
      const form = page.locator('[data-course-key="english-3"] [data-testid="task-report"]').first();
      let formCount = await form.count();
      if (formCount === 0) {
        const edit = page.locator('[data-course-key="english-3"] [data-testid="task-row"] button').first();
        if (await edit.count()) { await edit.click(); await page.waitForTimeout(250); }
        formCount = await form.count();
      }
      if (formCount === 0) {
        rec(`2.report-task-${tag}`, false, `no report form found (task rows: ${rowCount})`);
      } else {
        const current = await form.locator("select").inputValue();
        const target = current === "in_progress" ? "submitted" : "in_progress";
        await form.locator("select").selectOption(target);
        const score = form.locator('[data-testid="input-task-score"]');
        if (await score.count()) await score.fill("88");
        if (width === 390 || width === 1440) await shot(page, `${width === 1440 ? "08" : "09"}-hs-task-report-${tag}-light.png`);
        const a = await audit(page, `subjects-report-${tag}`, width);
        await form.locator('[data-testid="button-save-task"]').click();
        await page.waitForTimeout(800);
        const post = requests.find((r) => r.method === "POST" && r.path === "/api/student/high-school/progress");
        const body = post?.body;
        const bodyOk = !!body && typeof body.courseKey === "string" && body.courseKey === "english-3" && typeof body.taskKey === "string" && body.status === target && (body.reportedScorePercent === 88 || body.reportedScorePercent === null) && Number.isInteger(body.expectedRevision) && !("studentId" in body) && !("credit" in body);
        rec(`2.report-task-${tag}`, bodyOk, post ? `POST /api/student/high-school/progress body=${JSON.stringify(body)}` : "no POST issued");
        const toast = await page.evaluate(() => document.body.innerText.includes("This is your report; the school confirms official results"));
        rec(`2.report-toast-${tag}`, toast, toast ? "toast says it is the student's report, school confirms official results" : "toast not found");
        const creditsAfter = await creditsText();
        // creditsBefore was measured on the journey tab; re-measure there
        await page.click('[data-testid="tab-journey"]'); await page.waitForTimeout(250);
        const creditsAfterJ = await creditsText();
        rec(`2.no-official-credit-increase-${tag}`, creditsAfterJ === creditsBefore, `journey credit text unchanged after report: ${creditsAfterJ === creditsBefore} (${creditsBefore.slice(0, 120)})`);
        void creditsAfter; void a;
      }
      // touch targets across tabs at 390
      if (width === 390) {
        for (const id of ["tab-journey", "tab-subjects", "tab-graduation"]) {
          await page.click(`[data-testid="${id}"]`); await page.waitForTimeout(250);
          const a = await audit(page, `${id}-390`, 390);
          rec(`6.touch-${id}-390`, a.small.length === 0, a.small.join("; ") || "all >= 44px");
          // The "Saved" toast from the report test is still on screen; its Radix viewport internals (empty <ol>, focus-proxy spans) are library output, reported separately.
          const own = a.violations.filter((x: any) => !x.sample.every((t: string) => /^(ol|\.group|span\[aria-hidden|div\[role="region"\])/.test(t)));
          rec(`6.axe-overflow-${id}-390`, !a.overflow && own.filter((x: any) => x.impact === "serious" || x.impact === "critical").length === 0, `overflow=${a.overflow}; own-axe=${own.map((x: any) => `${x.id}(${x.impact})`).join(",") || "clean"}; radix-toast-viewport-only=${a.violations.filter((x: any) => !own.includes(x)).map((x: any) => x.id).join(",") || "none"}`);
        }
      }
      await ctx.close();
    }

    // ── 3. new student / nothing reported ─────────────────────────────────────────────
    {
      const { page, ctx } = await ctxPage(browser, { role: "student", theme: "light", width: 390, handler: studentHandler(HS_NEW_STUDENT) });
      await page.goto(BASE + "/high-school"); await settle(page, '[data-testid="hs-header"]');
      const st = await page.evaluate(() => ({
        pace: !!document.querySelector('[data-testid="pace-empty"]'),
        paceBar: !!document.querySelector('[data-testid="target-progress"]'),
        meter: document.querySelectorAll('[data-testid="pace-meter"]').length,
        text: (document.querySelector('[data-testid="pace-empty"]') as HTMLElement | null)?.innerText ?? "",
      }));
      await shot(page, "10-hs-new-student-390-light.png");
      rec("3.new-student-enrolled-empty", st.pace && !st.paceBar && st.meter === 0, `pace-empty=${st.pace}, pace bar present=${st.paceBar}, meters=${st.meter}; "${st.text.replace(/\s+/g, " ").slice(0, 160)}"`);
      const a = await audit(page, "new-student-390", 390);
      rec("6.new-student-390", !a.overflow && a.small.length === 0 && a.violations.filter((x: any) => x.impact === "serious" || x.impact === "critical").length === 0, `overflow=${a.overflow}; small=${a.small.join("; ") || "none"}; axe=${a.violations.map((x: any) => `${x.id}(${x.impact})`).join(",") || "clean"}`);
      await ctx.close();
    }
    {
      const { page, ctx } = await ctxPage(browser, { role: "student", theme: "light", width: 390, handler: studentHandler(null, (req) => (req.path === "/api/student/programs" ? ok({ programs: [] }) : null)) });
      await page.goto(BASE + "/high-school"); await settle(page, '[data-testid="hs-no-enrollment"], [data-testid="hs-header"]');
      const ne = await page.evaluate(() => ({ el: !!document.querySelector('[data-testid="hs-no-enrollment"]'), text: (document.querySelector('[data-testid="hs-no-enrollment"]') as HTMLElement | null)?.innerText ?? "", bars: document.querySelectorAll('[data-testid="pace-meter"],[data-testid="target-progress"]').length }));
      await shot(page, "11-hs-no-enrollment-390-light.png");
      rec("3.no-enrollment-empty-state", ne.el && ne.bars === 0, `hs-no-enrollment=${ne.el}; bars=${ne.bars}; "${ne.text.replace(/\s+/g, " ").slice(0, 160)}"`);
      const a = await audit(page, "no-enrollment-390", 390);
      rec("6.no-enrollment-390", !a.overflow && a.small.length === 0 && a.violations.filter((x: any) => x.impact === "serious" || x.impact === "critical").length === 0, `overflow=${a.overflow}; small=${a.small.join("; ") || "none"}; axe=${a.violations.map((x: any) => `${x.id}(${x.impact})`).join(",") || "clean"}`);
      await ctx.close();
    }

    // ── 4. admin workspace portal account card, add student ───────────────────────────
    const SID = "s-100";
    const workspace = { student: { id: SID, student_code: "LUM-0100", first_name: "Noa", last_name: "Fischer", email: "noa.fischer@synthetic.example", status: "active", residency: "us" }, report: {}, needsAttention: {}, displayLabels: {} };
    const candidate = { userId: "u-cand", email: "noa.fischer@synthetic.example", name: "Noa Fischer", createdAt: "2026-10-20T10:00:00.000Z" };
    const accountStates: Record<string, any> = {
      candidate: { studentId: SID, studentEmail: "noa.fischer@synthetic.example", linked: false, account: null, candidates: [candidate] },
      none: { studentId: SID, studentEmail: "noa.fischer@synthetic.example", linked: false, account: null, candidates: [] },
      linked: { studentId: SID, studentEmail: "noa.fischer@synthetic.example", linked: true, account: { userId: "u-cand", email: "noa.fischer@synthetic.example", role: "student" }, candidates: [] },
    };
    const adminHandler = (accountState: string, extra?: Handler): Handler => (req) => {
      const e = extra?.(req); if (e) return e;
      const p = req.path;
      if (p === `/api/admin/students/${SID}/workspace`) return ok(workspace);
      if (p === `/api/admin/students/${SID}/account`) return ok(accountStates[accountState]);
      if (p === "/api/admin/students") return ok({ students: [{ id: SID, student_code: "LUM-0100", first_name: "Noa", last_name: "Fischer", email: "noa.fischer@synthetic.example", status: "active", residency: "us", created_at: "2026-10-01T00:00:00Z" }] });
      if (p.startsWith("/api/documents")) return ok([]);
      if (p.startsWith("/api/tickets")) return ok({ tickets: [], pagination: { total: 0, limit: 100, offset: 0 } });
      return null;
    };
    const cardSel = '[data-testid="portal-account-card"]';

    for (const width of [1440, 390]) {
      const tag = `${width}`;
      // candidate state -> link
      {
        const { page, ctx, requests } = await ctxPage(browser, { role: "admin", theme: "light", width, handler: adminHandler("candidate", (req) => (req.method === "POST" && req.path === `/api/admin/students/${SID}/account/link` ? ok(accountStates.linked) : null)) });
        await page.goto(`${BASE}/admin/students/${SID}`); await settle(page, cardSel);
        await page.locator(cardSel).scrollIntoViewIfNeeded();
        if (width === 1440) await shot(page, "12-admin-account-candidate-1440-light.png");
        const a = await audit(page, `admin-account-candidate-${tag}`, width, "main a[href], main button");
        rec(`6.admin-workspace-${tag}`, !a.overflow && a.violations.filter((x: any) => x.impact === "serious" || x.impact === "critical").length === 0, `overflow=${a.overflow}; axe=${a.violations.map((x: any) => `${x.id}(${x.impact})x${x.nodes}`).join(",") || "clean"}`);
        await page.click('[data-testid="portal-account-link"]');
        await page.waitForSelector('[role="dialog"]');
        if (width === 390) await shot(page, "13-admin-link-confirm-dialog-390-light.png");
        const dlg = await page.locator('[role="dialog"]').innerText();
        await page.click('[data-testid="portal-account-link-confirm"]');
        await page.waitForTimeout(800);
        const post = requests.find((r) => r.path === `/api/admin/students/${SID}/account/link`);
        const linkedShown = await page.locator('[data-testid="portal-account-email"]').count();
        rec(`4.link-account-${tag}`, !!post && post.body?.userId === "u-cand" && Object.keys(post.body).length === 1 && linkedShown === 1, `dialog "${dlg.replace(/\s+/g, " ").slice(0, 90)}"; POST body=${JSON.stringify(post?.body)}; card then shows linked email=${linkedShown === 1}`);
        await ctx.close();
      }
      // none -> invite once
      {
        const { page, ctx, requests } = await ctxPage(browser, { role: "admin", theme: "light", width, handler: adminHandler("none", (req) => (req.method === "POST" && req.path === "/api/admin/invitations" ? ok({ email: "noa.fischer@synthetic.example", expiresAt: "2026-11-05T00:00:00.000Z", token: "TOK-ABC123" }) : null)) });
        await page.goto(`${BASE}/admin/students/${SID}`); await settle(page, cardSel);
        await page.locator(cardSel).scrollIntoViewIfNeeded();
        await page.click('[data-testid="portal-account-invite"]');
        await page.waitForSelector('[data-testid="portal-account-invitation"]');
        const txt = await page.locator('[data-testid="portal-account-invitation"]').innerText();
        const val = await page.inputValue("#invitation-link");
        if (width === 1440) await shot(page, "14-admin-invitation-issued-1440-light.png");
        const post = requests.find((r) => r.path === "/api/admin/invitations");
        const inviteBtnGone = (await page.locator('[data-testid="portal-account-invite"]').count()) === 0;
        rec(`4.invite-${tag}`, !!post && post.body?.email === "noa.fischer@synthetic.example" && val.includes("TOK-ABC123") && txt.includes("shown only once") && inviteBtnGone, `POST /api/admin/invitations ${JSON.stringify(post?.body)}; url=${val}; once-notice=${txt.includes("shown only once")}; invite button hidden after=${inviteBtnGone}`);
        const a = await audit(page, `admin-invite-${tag}`, width, "main a[href], main button");
        if (a.overflow) rec(`6.admin-invite-overflow-${tag}`, false, `scroll ${a.sw}>${a.cw}`);
        await ctx.close();
      }
      // linked -> email + unlink secondary
      {
        const { page, ctx } = await ctxPage(browser, { role: "admin", theme: "light", width, handler: adminHandler("linked") });
        await page.goto(`${BASE}/admin/students/${SID}`); await settle(page, cardSel);
        await page.locator(cardSel).scrollIntoViewIfNeeded();
        const email = await page.locator('[data-testid="portal-account-email"]').innerText();
        const unlinkCls = await page.locator('[data-testid="portal-account-unlink"]').getAttribute("class");
        const noPrimaryLink = (await page.locator('[data-testid="portal-account-link"]').count()) === 0;
        if (width === 390) await shot(page, "15-admin-account-linked-390-light.png");
        await page.click('[data-testid="portal-account-unlink"]');
        await page.waitForSelector('[role="dialog"]');
        const disabledBefore = await page.locator('[data-testid="portal-account-unlink-confirm"]').isDisabled();
        rec(`4.linked-${tag}`, email.includes("@") && noPrimaryLink && disabledBefore, `email=${email}; unlink opens dialog with confirm disabled until reason=${disabledBefore}; unlink btn class has outline/ghost=${/ghost|outline|border/.test(unlinkCls ?? "")}`);
        await ctx.close();
      }
    }
    // Admin students tab: Add student dialog
    for (const width of [1440, 390]) {
      const { page, ctx, requests } = await ctxPage(browser, { role: "admin", theme: "light", width, handler: adminHandler("none", (req) => (req.method === "POST" && req.path === "/api/students" ? { status: 201, body: { id: "s-new" } } : null)) });
      await page.goto(`${BASE}/admin?tab=students`); await settle(page, '[data-testid="button-add-student"]');
      await page.click('[data-testid="button-add-student"]');
      await page.waitForSelector('[role="dialog"]');
      const submit = page.locator('[data-testid="button-add-student-submit"]');
      const disabledEmpty = await submit.isDisabled();
      if (width === 390) await shot(page, "16-admin-add-student-dialog-390-light.png");
      await page.fill("#new-student-first", "Lena"); await page.fill("#new-student-last", "Park"); await page.fill("#new-student-email", "Lena.Park@Synthetic.example");
      const disabledPartial = await submit.isDisabled();
      await page.fill("#new-student-dob", "2010-04-12"); await page.fill("#new-student-phone", "+1 555 0100"); await page.fill("#new-student-address", "1 Main St");
      const enabledFull = !(await submit.isDisabled());
      const a = await audit(page, `admin-add-student-${width}`, width, '[role="dialog"] button, [role="dialog"] input, [role="dialog"] select');
      await submit.click(); await page.waitForTimeout(800);
      const post = requests.find((r) => r.method === "POST" && r.path === "/api/students");
      const good = !!post && !("user_id" in post.body) && post.body.email === "lena.park@synthetic.example" && post.body.status === "lead" && post.body.first_name === "Lena";
      rec(`4.add-student-${width}`, disabledEmpty && disabledPartial && enabledFull && good, `submit disabled when empty=${disabledEmpty}, partial=${disabledPartial}; enabled when complete=${enabledFull}; POST /api/students has user_id=${post ? "user_id" in post.body : "n/a"}, email=${post?.body?.email}, status=${post?.body?.status}; navigated to ${new URL(page.url()).pathname}`);
      rec(`6.add-student-dialog-${width}`, !a.overflow && a.violations.filter((x: any) => x.impact === "serious" || x.impact === "critical").length === 0, `overflow=${a.overflow}; axe=${a.violations.map((x: any) => `${x.id}(${x.impact})x${x.nodes}`).join(",") || "clean"}${a.small.length ? `; small dialog controls: ${a.small.join("; ")}` : ""}`);
      await ctx.close();
    }

    // ── 5. staff high school Roadmap tab, electives ───────────────────────────────────
    for (const width of [1440, 390]) {
      let state = staffStateRich();
      const { page, ctx } = await ctxPage(browser, { role: "admin", theme: "light", width, handler: (req) => {
        const p = req.path;
        if (p === `/api/admin/students/${HS_STUDENT_ID}/high-school`) return ok(state);
        if (p === "/api/admin/high-school/templates") return ok({ templates: FIXTURE_TEMPLATES });
        if (p === `/api/documents/student/${HS_STUDENT_ID}`) return ok(FIXTURE_DOCS);
        if (p.startsWith("/api/documents")) return ok([]);
        return null;
      } });
      void state;
      await page.goto(`${BASE}/admin/students/${HS_STUDENT_ID}/high-school?tab=roadmap`);
      await page.waitForSelector("[role=tabpanel] h2", { timeout: 25_000 }); await page.waitForTimeout(600);
      const info = await page.evaluate(() => {
        const groups = Array.from(document.querySelectorAll('[data-testid="area-group"]')).map((g) => (g.textContent || "").replace(/\s+/g, " ").trim().slice(0, 110));
        const el = groups.find((t) => /elective/i.test(t));
        return { groups, el };
      });
      await page.evaluate(() => document.querySelector('[data-testid="course-plan"]')?.scrollIntoView());
      await shot(page, `17-staff-roadmap-electives-${width}-light.png`);
      const planned = !!info.el && /of .* planned/.test(info.el);
      const before = await page.locator('[data-testid="plan-course"]').count();
      const electiveBefore = info.el ?? "";
      await page.click('button:has-text("Add a course")');
      await page.waitForSelector("#new-course-title");
      await page.fill("#new-course-title", "Study Skills Seminar");
      const areaOpts = await page.locator("#new-course-area option").allTextContents();
      const electiveOpt = areaOpts.find((t) => /elective/i.test(t));
      if (electiveOpt) await page.selectOption("#new-course-area", { label: electiveOpt });
      await page.waitForTimeout(200);
      const add = page.locator("#new-course-add");
      let added = false, note = "";
      const disabled = await add.getAttribute("aria-disabled");
      const startField = await page.inputValue("#new-course-start"); const endField = await page.inputValue("#new-course-end");
      if (disabled === "true" || (await add.isDisabled().catch(() => false))) {
        if (!startField) await page.fill("#new-course-start", "2028-07-03");
        if (!endField) await page.fill("#new-course-end", "2028-07-28");
        await page.waitForTimeout(200);
      }
      const stillDisabled = (await add.getAttribute("aria-disabled")) === "true" || (await add.isDisabled().catch(() => false));
      if (!stillDisabled) {
        await add.click(); await page.waitForTimeout(500);
        const after = await page.evaluate(() => Array.from(document.querySelectorAll('[data-testid="area-group"]')).map((g) => (g.textContent || "").replace(/\s+/g, " ").trim().slice(0, 110)).find((t) => /elective/i.test(t)));
        const n = (t: string | undefined) => Number(/Electives\s*([\d.]+) of/.exec(t ?? "")?.[1] ?? NaN);
        const courseCount = await page.locator('[data-testid="plan-course"]').count();
        const titleVisible = (await page.locator("body").innerText()).includes("Study Skills Seminar");
        const cnt = (t: string | undefined) => Number(/(\d+) courses?/.exec(t ?? "")?.[1] ?? NaN);
        void courseCount; void titleVisible;
        added = n(after) > n(electiveBefore) && cnt(after) === cnt(electiveBefore) + 1 && (await page.locator("text=Unsaved changes").count()) > 0;
        note = `elective row before: "${electiveBefore}" | after: "${after}"; dirty badge=${(await page.locator("text=Unsaved changes").count()) > 0}`;
      } else note = `Add to plan stayed disabled (title/area/credit/dates). start="${startField}" end="${endField}"`;
      await page.waitForTimeout(300);
      await shot(page, `18-staff-roadmap-elective-added-${width}-light.png`);
      rec(`5.electives-visible-${width}`, planned, `elective area row: "${electiveBefore}"; area rows=${info.groups.length}; courses before add=${before}`);
      rec(`5.add-elective-${width}`, added, note);
      const a = await audit(page, `staff-roadmap-${width}`, width, "main a[href], main button");
      rec(`6.staff-roadmap-${width}`, !a.overflow && a.violations.filter((x: any) => x.impact === "serious" || x.impact === "critical").length === 0, `overflow=${a.overflow}; axe=${a.violations.map((x: any) => `${x.id}(${x.impact})x${x.nodes}`).join(",") || "clean"}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
    fs.writeFileSync(path.join(OUT, "browser-results.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: "LOCAL UI SIMULATION: vite dev server, Playwright route interception, stubbed auth and APIs, synthetic fixtures. Not hosted acceptance.",
      axe: "axe-core 4.x injected from node_modules (@axe-core/playwright is not installed); tags wcag2a/wcag2aa/wcag21aa/best-practice",
      checks: results, axeScreens: axeLog, layout: overflowLog, issues,
    }, null, 2));
  }
  const failed = Object.entries(results).filter(([, v]) => !v.pass);
  console.log(`\n${Object.keys(results).length} checks, ${failed.length} failed`);
  for (const [k, v] of failed) console.log("FAILED", k, v.note);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
