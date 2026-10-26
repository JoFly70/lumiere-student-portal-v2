/**
 * S12 evidence: renders the graduate module in Chromium from SYNTHETIC fixtures.
 *
 *   npx tsx scripts/s12/render-graduate-screens.ts
 *   (S12_SCREENS_OUT=docs/s12/screens by default)
 *
 * Student "My Master's" (/graduate) for Journey A (ENEB-only) and Journey B stages,
 * at 1440 and 390, light and dark; the staff Graduate programmes panel in the admin
 * student workspace (staff and admin), including a Verify dialog that the server
 * refuses with 422. Writes axe-summary.json and overflow-audit.json next to the PNGs.
 *
 * Auth and every /api call are stubbed; external fonts are blocked. These are renders
 * of fixtures, not of a deployment.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildEvaluationView, buildStaffGraduateProgramView, buildStudentGraduateProgramView, evaluateEvaluationVerification, type CredentialEvaluationRecord, type GraduateProgramBundle, type StaffGraduateWorkspace } from "../../shared/graduate-program-contract";
import { OFFERINGS, RULE_SETS, RULE_SET_2025, journeyA, journeyB, syntheticEvaluations, type JourneyBStage } from "../../tests/helpers/s12-graduate-fixtures";
import { STAFF_STUDENT_ID, staffReviewProfile, staffWorkspacePayload } from "../../tests/helpers/s09-profile-ui-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(process.env.S12_SCREENS_OUT ?? path.join(ROOT, "docs/s12/screens"));
const PORT = Number(process.env.S12_PORT ?? 5212);
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

interface Opts { role: "student" | "staff" | "admin"; width: number; height: number; theme?: "light" | "dark"; studentBundles?: GraduateProgramBundle[]; staffBundles?: GraduateProgramBundle[]; evaluations?: CredentialEvaluationRecord[] }

const staffWorkspace = (bundles: GraduateProgramBundle[], role: "staff" | "admin", evaluations: CredentialEvaluationRecord[] = []): StaffGraduateWorkspace => ({
  studentId: STAFF_STUDENT_ID,
  viewerRole: role,
  programs: bundles.map((b) => buildStaffGraduateProgramView(b, b.ruleSet.id, role)),
  offerings: OFFERINGS,
  ruleSets: RULE_SETS,
  evaluations: evaluations.map((e) => ({
    ...e,
    view: buildEvaluationView(e),
    blockers: e.verificationStatus === "verified" ? [] : evaluateEvaluationVerification(e, { decision: "verified", conflictingEvidence: null, note: "guidance" }, role).missing,
  })),
});

async function newPage(browser: any, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  const user = o.role === "student"
    ? { id: "u1", email: "student@synthetic.example", name: "Synthetic Student", role: "student" }
    : { id: "staff-1", email: "camille.moreau@synthetic.example", name: "Camille Moreau", role: o.role };
  await ctx.addInitScript(() => { (globalThis as any).__name = (f: unknown) => f; });
  await ctx.addInitScript(([theme, u]: [string, unknown]) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
  }, [o.theme ?? "light", user] as [string, unknown]);
  const studentView = { programs: (o.studentBundles ?? []).map(buildStudentGraduateProgramView), evaluations: (o.evaluations ?? []).map(buildEvaluationView) };
  const ws = staffWorkspace(o.staffBundles ?? [], o.role === "admin" ? "admin" : "staff", o.evaluations ?? []);
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    const method = route.request().method();
    if (p === "/api/student/graduate") return json(200, studentView);
    if (p === `/api/admin/students/${STAFF_STUDENT_ID}/graduate`) return json(200, ws);
    if (/^\/api\/admin\/graduate\/records\/[^/]+\/verify$/.test(p) && method === "POST") {
      return json(422, { error: { code: "GRADUATE_EVIDENCE_REQUIRED", message: "The evidence required for this official change is incomplete", missing: ["DOCUMENT_REFERENCE_REQUIRED", "DECISION_DATE_REQUIRED", "MATRICOLA_REQUIRED"] } });
    }
    if (p === "/api/students/me") return json(200, { id: "s1", user_id: "u1", student_code: "LUM-SYN-0001", first_name: "Synthetic", last_name: "Student", email: "student@synthetic.example", status: "active" });
    if (p === `/api/students/${STAFF_STUDENT_ID}/profile`) return json(200, staffReviewProfile());
    if (p === `/api/students/${STAFF_STUDENT_ID}/identity-corrections`) return json(200, []);
    if (p === `/api/admin/students/${STAFF_STUDENT_ID}/workspace`) return json(200, staffWorkspacePayload());
    if (p.startsWith("/api/documents/student/")) return json(200, []);
    if (p === "/api/tickets") return json(200, { tickets: [], pagination: { total: 0, limit: 50, offset: 0 } });
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  return { page, ctx };
}

async function settle(page: any, selector: string) {
  await page.waitForSelector(selector, { timeout: 20_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
}

async function shot(page: any, name: string): Promise<void> {
  const h = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement | null;
    return Math.max(main ? main.scrollHeight + 150 : 0, document.documentElement.scrollHeight);
  });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 9000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.setViewportSize(vp);
  console.log("wrote", name, h);
}

const axeResults: unknown[] = [];
async function runAxe(page: any, label: string) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    const res = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n: any) => n.target.join(" ")) }));
  });
  axeResults.push({ screen: label, violations: r });
  console.log("axe", label, r.map((v: any) => `${v.id}(${v.impact})x${v.nodes}`).join(", ") || "clean");
}

const overflowResults: unknown[] = [];
async function overflow(page: any, label: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main") as HTMLElement | null;
    const out: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page ${doc.scrollWidth} > ${doc.clientWidth}`);
    if (main && main.scrollWidth > main.clientWidth + 1) out.push(`main ${main.scrollWidth} > ${main.clientWidth}`);
    return out;
  });
  overflowResults.push({ screen: label, overflow: r });
}

async function main() {
  fs.mkdirSync(path.join(OUT, "student"), { recursive: true });
  fs.mkdirSync(path.join(OUT, "staff"), { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  const D = { width: 1440, height: 900 };
  const M = { width: 390, height: 844 };
  try {
    const studentScreens: Array<[string, GraduateProgramBundle[]]> = [
      ["a-eneb-only", [journeyA()]],
      ...(["eligibility", "registered", "partial_recognition", "thesis_submitted", "procedure_done", "conferred", "complete"] as JourneyBStage[]).map(
        (s) => [`b-${s.replace(/_/g, "-")}`, [journeyB(s)]] as [string, GraduateProgramBundle[]],
      ),
      ["b-2025-cohort", [journeyB("registered", { ruleSet: RULE_SET_2025 })]],
      ["multi-programme", [journeyB("partial_recognition"), journeyA()]],
    ];
    for (const [name, bundles] of studentScreens) {
      for (const [vp, tag] of [[D, "1440"], [M, "390"]] as const) {
        const evaluations = name === "b-conferred" || name === "b-complete" ? syntheticEvaluations() : [];
        const { page, ctx } = await newPage(browser, { role: "student", ...vp, studentBundles: bundles, evaluations });
        await page.goto(`${BASE}/graduate`);
        await settle(page, '[data-testid="graduate-program"]');
        await overflow(page, `student/${name}-${tag}`);
        await shot(page, `student/${name}-${tag}.png`);
        if (tag === "1440" && (name === "b-partial-recognition" || name === "a-eneb-only" || name === "b-procedure-done")) await runAxe(page, `student/${name}`);
        await ctx.close();
      }
    }
    for (const name of ["b-partial-recognition", "b-procedure-done"]) {
      const stage = name === "b-partial-recognition" ? "partial_recognition" : "procedure_done";
      const { page, ctx } = await newPage(browser, { role: "student", ...D, theme: "dark", studentBundles: [journeyB(stage)] });
      await page.goto(`${BASE}/graduate`);
      await settle(page, '[data-testid="graduate-program"]');
      await shot(page, `student/${name}-1440-dark.png`);
      await runAxe(page, `student/${name}-dark`);
      await ctx.close();
    }

    // Staff panel: section screenshot of #workspace-graduate inside the real workspace page.
    const staffScreens: Array<[string, "staff" | "admin", GraduateProgramBundle[], { w: number; h: number }]> = [
      ["admitted-staff", "staff", [journeyB("admitted")], { w: D.width, h: D.height }],
      ["partial-recognition-staff", "staff", [journeyB("partial_recognition")], { w: D.width, h: D.height }],
      ["procedure-done-admin", "admin", [journeyB("procedure_done")], { w: D.width, h: D.height }],
      ["eneb-only-staff", "staff", [journeyA()], { w: D.width, h: D.height }],
      ["admitted-staff-390", "staff", [journeyB("admitted")], { w: M.width, h: M.height }],
    ];
    for (const [name, role, bundles, vp] of staffScreens) {
      const evaluations = name === "procedure-done-admin" ? syntheticEvaluations() : [];
      const { page, ctx } = await newPage(browser, { role, width: vp.w, height: vp.h, staffBundles: bundles, evaluations });
      // Admins see the panel inside the workspace; staff use the staff+admin graduate page.
      await page.goto(role === "admin" ? `${BASE}/admin/students/${STAFF_STUDENT_ID}` : `${BASE}/admin/students/${STAFF_STUDENT_ID}/graduate`);
      await settle(page, '[data-testid="graduate-program"]');
      await overflow(page, `staff/${name}`);
      const section = page.locator("#workspace-graduate");
      // Grow the viewport so the whole panel is painted before the element capture.
      const box = await section.evaluate((el: HTMLElement) => ({ top: el.getBoundingClientRect().top + window.scrollY, h: el.scrollHeight }));
      await page.setViewportSize({ width: vp.w, height: Math.min(Math.ceil(box.top + box.h + 200), 12000) });
      await page.waitForTimeout(300);
      await section.screenshot({ path: path.join(OUT, `staff/${name}.png`) });
      await page.setViewportSize({ width: vp.w, height: vp.h });
      console.log("wrote", `staff/${name}.png`);
      if (name === "admitted-staff") {
        await runAxe(page, "staff/admitted");
        // Verify registration without evidence: the server's 422 reasons stay in the dialog.
        const reg = page.locator('[data-testid="graduate-record"]', { hasText: "University registration" }).first();
        await reg.getByRole("button", { name: "Verify…" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await dialog.locator("textarea").last().fill("Checked with admissions; awaiting the letter.");
        await dialog.getByRole("button", { name: /verify|save|record/i }).last().click();
        await page.waitForSelector('[data-testid="dialog-missing"]', { timeout: 10_000 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, "staff/verify-refused-422.png") });
        console.log("wrote staff/verify-refused-422.png");
      }
      await ctx.close();
    }
  } finally {
    fs.writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify(axeResults, null, 2));
    fs.writeFileSync(path.join(OUT, "overflow-audit.json"), JSON.stringify(overflowResults, null, 2));
    await browser.close();
    try { process.kill(-vite.pid!); } catch { vite.kill(); }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
