/**
 * S27 student screens: screenshots + a few real-browser behaviour checks.
 *   npx tsx scripts/s27/render-student-screens.ts [screens=all] [outDir]
 * LOCAL UI SIMULATION: vite dev server + Playwright route interception. Auth and every /api call are stubbed from
 * SYNTHETIC fixtures (tests/helpers/s27-fixtures.ts); external hosts are blocked. No backend, no deployment.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { BILLING_CONFIGURED } from "../../tests/helpers/s18-billing-fixtures";
import { RICH_PROFILE } from "../../tests/helpers/s09-profile-ui-fixtures";
import { S27_DOCS, s27HsView, s27Journey } from "../../tests/helpers/s27-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = process.argv[3] ?? "/tmp/claude-0/-home-user-lumiere-student-portal-v2/3fe3534a-089d-5422-bbea-48defd3b03e0/scratchpad/s27-shots/student";
const PORT = Number(process.env.S27_PORT ?? 5273);
const BASE = `http://localhost:${PORT}`;
const NOW = new Date("2026-10-29T18:30:00");

const SCREENS: Record<string, { path: string; wait: string }> = {
  "flight-deck": { path: "/flight-deck", wait: '[data-testid="hs-flight-deck"]' },
  roadmap: { path: "/high-school", wait: '[data-testid="hs-roadmap"]' },
  beyond: { path: "/beyond", wait: '[data-testid="beyond-page"]' },
  documents: { path: "/documents", wait: '[data-testid="page-documents"]' },
  billing: { path: "/billing", wait: '[data-testid="page-billing"]' },
  support: { path: "/support", wait: '[data-testid="original-student-support"]' },
  profile: { path: "/profile", wait: '[data-testid="page-student-profile"]' },
};

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

interface Opts { width: number; height: number; theme: "lumiere" | "lumiere-dark"; lang?: "en" | "fr"; journey?: "ok" | "404"; reduced?: boolean; failProgress?: number }
export const requests: { url: string; method: string; body: any }[] = [];

async function newPage(browser: any, screen: string, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: o.reduced ? "reduce" : "no-preference", hasTouch: o.width < 500 });
  const user = { id: "student-user-1", email: "noa.fischer@synthetic.example", name: "Noa Fischer", role: "student" };
  await ctx.addInitScript(([theme, u, lang]: [string, unknown, string]) => {
    localStorage.setItem("lumiere-portal:theme", theme);
    localStorage.setItem("lumiere_language", lang);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: 4102444800 } }));
  }, [o.theme, user, o.lang ?? "en"] as [string, unknown, string]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.clock.setFixedTime(NOW);
  let hs = s27HsView();
  const journey = s27Journey();
  let progressCalls = 0;
  await ctx.route(/.*/, async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.hostname !== "localhost") return route.abort();
    const p = url.pathname;
    if (!p.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const body = r.method() === "GET" ? undefined : JSON.parse(r.postData() || "{}");
    if (r.method() !== "GET") requests.push({ url: p, method: r.method(), body });
    if (p === "/api/student/high-school/progress") {
      progressCalls += 1;
      if (o.failProgress && progressCalls <= o.failProgress) return json(409, { error: { code: "HS_REVISION_CONFLICT", message: "revision" } });
      hs = {
        ...hs,
        subjects: hs.subjects.map((s) => ({ ...s, courses: s.courses.map((c) => c.key !== body.courseKey ? c : { ...c, tasks: c.tasks.map((t) => t.key === body.taskKey ? { ...t, status: "pending_review" as const, reportedScorePercent: body.reportedScorePercent ?? null, progressRevision: t.progressRevision + 1 } : t) }) })),
      };
      return json(200, hs);
    }
    if (p === "/api/student/high-school") return json(200, hs);
    if (p === "/api/student/journey") return o.journey === "404" ? json(404, { error: { code: "S27_NOT_FOUND", message: "none" } }) : json(200, journey);
    if (p === "/api/student/orientation-sessions") return json(201, { id: "ses-new", slotAt: body.slotAt, status: "requested", prep: body.prep, notes: null, createdAt: NOW.toISOString() });
    if (p === "/api/student/programs") return json(200, { programs: [{ kind: "high_school", id: "e1", title: "High School Diploma (21 credits)", status: "active", current: true }] });
    if (p === "/api/students/me") return json(200, { id: "s1", student_code: "SYN-001", first_name: "Noa", last_name: "Fischer", email: user.email, photo_url: null });
    if (p === "/api/students/me/profile") return json(200, RICH_PROFILE);
    if (p.startsWith("/api/documents/student/")) return json(200, S27_DOCS);
    if (p === "/api/tickets" && r.method() === "GET") return json(200, { tickets: [{ id: "t1", ticket_number: "SUP-0001", subject: "Question about my plan", status: "in_progress", priority: "medium", category: "academic", topic: "roadmap_question", created_at: "2026-10-25T10:00:00Z", updated_at: "2026-10-27T10:00:00Z", last_public_reply_by: "staff", last_public_reply_at: "2026-10-27T10:00:00Z", comment_count: 2, attachment_count: 0 }], pagination: { total: 1, limit: 100, offset: 0 } });
    if (p === "/api/tickets" && r.method() === "POST") return json(201, { ticket: { id: "t2", ticket_number: "SUP-0002" } });
    if (p === "/api/student/billing") return json(200, BILLING_CONFIGURED);
    if (p === "/api/assistant/status") return json(200, { enabled: true, liveModel: false, mode: "local", suggestions: [{ id: "roadmap-how", en: "How does my roadmap work?", fr: "Comment fonctionne ma feuille de route ?" }] });
    if (p === "/api/assistant/conversations") return r.method() === "GET" ? json(200, { conversations: [] }) : json(201, { conversation: { id: "conv-new-0001", title: "", createdAt: NOW.toISOString(), lastActivityAt: NOW.toISOString(), archived: false, messageCount: 0, lastMessagePreview: null } });
    if (/^\/api\/assistant\/conversations\/[^/]+\/messages$/.test(p)) {
      return json(200, {
        studentMessage: { id: "m1", seq: 1, role: "student", content: body.message, createdAt: NOW.toISOString(), attachments: [] },
        assistantMessage: { id: "m2", seq: 2, role: "assistant", content: "You need 12 more credits. 9 are confirmed by your school and 1 is waiting for results.", mode: "local", sources: [{ title: "Your roadmap", url: "https://example.org/roadmap", verifiedAt: "2026-10-27" }], links: [], createdAt: NOW.toISOString() },
        replayed: false,
      });
    }
    if (p === "/api/student/attachments/policy") return json(200, { enabled: false });
    if (p === "/api/student/welcome") return json(404, { error: "none" });
    if (p === "/api/student/preferences") return json(200, { language: null });
    if (p === "/api/search") return json(200, { results: [] });
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m: any) => { if (m.type() === "error" && !/Failed to load resource|404|STUB/.test(m.text())) errors.push(`console.error: ${m.text().slice(0, 200)}`); });
  await page.goto(BASE + SCREENS[screen]!.path);
  try {
    await page.waitForSelector(SCREENS[screen]!.wait, { timeout: 30_000 });
  } catch (e) {
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, `debug-${screen}.png`) });
    console.error("WAIT FAILED", errors.join(" | "), (await page.evaluate(() => document.body.innerText)).slice(0, 400));
    throw e;
  }
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(1900);
  return { page, ctx, errors };
}

/** Full-height screenshot of the scrolling <main> region. */
async function fullShot(page: any, file: string) {
  const h = await page.evaluate(() => { const m = document.querySelector("main"); return m ? m.scrollHeight + 130 : document.documentElement.scrollHeight; });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 9000) });
  await page.waitForTimeout(500);
  await page.screenshot({ path: file });
  await page.setViewportSize(vp);
}

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => { checks.push({ name, ok, detail }); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };

/** Core flow: Log sheet -> HS progress POST (success, score guidance, optimistic UI, 409 conflict). */
async function logFlow(browser: any) {
  {
    const { page, ctx } = await newPage(browser, "roadmap", { width: 1440, height: 900, theme: "lumiere" });
    requests.length = 0;
    await page.click('[data-testid="now-log-science-physical"]');
    await page.waitForSelector('[data-testid="log-form"]');
    const item = await page.inputValue("#lg-item");
    check("sheet pre-selects the course and its next task (the retake)", (await page.inputValue("#lg-course")) === "science-physical" && item.endsWith("-exam"), item);
    await page.click('[role="radio"]:has-text("Graded")');
    await page.fill("#lg-score", "61");
    const hint = await page.textContent('[data-testid="log-hint"]');
    check("below 65 shows retake guidance", /Below 65%/.test(hint ?? ""), hint ?? "");
    await page.fill("#lg-score", "140");
    await page.click('button[type="submit"]');
    check("an out-of-range score is not sent", requests.length === 0 && /0 and 100/.test((await page.textContent('[data-testid="log-error"]')) ?? ""));
    await page.fill("#lg-score", "61");
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="log-sheet"]', { state: "detached" });
    const post = requests.find((r) => r.url === "/api/student/high-school/progress");
    check("POST carries status submitted, the score and expectedRevision", !!post && post.body.status === "submitted" && post.body.reportedScorePercent === 61 && typeof post.body.expectedRevision === "number", JSON.stringify(post?.body));
    await page.waitForTimeout(600);
    const dots = await page.$$eval('[data-testid="now-science-physical"] .dt2', (els: Element[]) => els.map((e) => e.className));
    check("the dot for the item now shows submitted (striped)", dots.some((c: string) => c.includes("sub")) && !dots.some((c: string) => c.includes("fail")), dots.join(" | "));
    await ctx.close();
  }
  {
    const { page, ctx } = await newPage(browser, "roadmap", { width: 390, height: 844, theme: "lumiere", failProgress: 1 });
    requests.length = 0;
    await page.click('[data-testid="rm-log-open"]');
    await page.waitForSelector('[data-testid="log-form"]');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="log-error"]');
    const msg = await page.textContent('[data-testid="log-error"]');
    check("409 revision conflict tells the student the plan was refreshed", /updated elsewhere/.test(msg ?? ""), msg ?? "");
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="log-sheet"]', { state: "detached" });
    check("a retry after the refresh saves", requests.filter((r) => r.url.endsWith("/progress")).length === 2);
    await ctx.close();
  }
  {
    const { page, ctx } = await newPage(browser, "flight-deck", { width: 1440, height: 900, theme: "lumiere", journey: "404" });
    check("journey 404 renders the designed notice and no agreement cards", (await page.$('[data-testid="fd-journey-pending"]')) !== null && (await page.$('[data-testid="alert-support"]')) === null);
    await ctx.close();
  }
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}

/** Orb avatar + chat panel: open from the FAB, ask a suggestion, capture the answer with its "From:" line. */
async function chatShots(browser: any) {
  for (const [width, height] of [[1440, 900], [390, 844]] as const) {
    for (const theme of ["lumiere", "lumiere-dark"] as const) {
      const { page, ctx } = await newPage(browser, "flight-deck", { width, height, theme });
      await page.click('[data-testid="assistant-fab"]');
      await page.waitForSelector('[data-testid="assistant-panel"]');
      await page.waitForTimeout(500);
      const tag = `${width}-${theme === "lumiere" ? "light" : "dark"}`;
      await page.screenshot({ path: path.join(OUT, `chat-open-${tag}.png`) });
      await page.click('[data-testid="assistant-suggestion-roadmap-how"]');
      await page.waitForSelector('[data-testid="assistant-answer"]');
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(OUT, `chat-answer-${tag}.png`) });
      check(`chat ${tag}: answer shows the From: source line and an orb avatar`, /From:/.test((await page.textContent('[data-testid="assistant-sources"]')) ?? "") && (await page.$('[data-testid="assistant-answer"] .lm-orb')) !== null);
      await ctx.close();
    }
  }
  // cockpit chip opens the assistant with the question
  const { page, ctx } = await newPage(browser, "flight-deck", { width: 1440, height: 900, theme: "lumiere" });
  await page.click('[data-testid="fd-ask"] .q >> nth=1');
  await page.waitForSelector('[data-testid="assistant-answer"]');
  check("cockpit chip sends the question through the assistant", (await page.textContent('[data-testid="assistant-user-message"]'))?.includes("urgent") === true);
  await ctx.close();
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
}

async function main() {
  const wanted = (process.argv[2] && process.argv[2] !== "all" ? process.argv[2].split(",") : Object.keys(SCREENS));
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  const report: Record<string, unknown> = {};
  try {
    if (process.argv[2] === "chat") { await chatShots(browser); return; }
    if (process.argv[2] === "log-flow") { await logFlow(browser); return; }
    for (const screen of wanted) {
      for (const [width, height] of [[1440, 900], [390, 844]] as const) {
        for (const theme of ["lumiere", "lumiere-dark"] as const) {
          const { page, ctx, errors } = await newPage(browser, screen, { width, height, theme });
          const overflow = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, main: (() => { const m = document.querySelector("main"); return m ? [m.scrollWidth, m.clientWidth] : null; })() }));
          const name = `${screen}-${width}-${theme === "lumiere" ? "light" : "dark"}.png`;
          await fullShot(page, path.join(OUT, name));
          report[name] = { overflow, errors };
          console.log(name, JSON.stringify(overflow), errors.join(" | "));
          await ctx.close();
        }
      }
    }
    fs.writeFileSync(path.join(OUT, "render-notes.json"), JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { /* already gone */ }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
