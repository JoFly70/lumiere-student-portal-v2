/**
 * S10 evidence: consolidated renders of the student experience in Chromium from
 * synthetic fixtures (Flight Deck, Roadmap, Support student + staff, Documents,
 * profile navigation state), at 1440 and 390, light and dark where meaningful.
 * Also writes axe-summary.json, overflow-audit.json (horizontal overflow at 390 and
 * 1440) and chrome-metrics.json (sticky chrome height, page height, toast overlap).
 *
 *   S10_SCREENS_OUT=docs/recovery/s10-evidence/screens npx tsx scripts/s10/render-consolidated-screens.ts
 *
 * Auth and every /api call are stubbed; external fonts are blocked. These are
 * renders of fixtures, not of a deployment. One synthetic student (Amélie Laurent,
 * LUM-0001) is used by every student screen; staff is Camille Moreau.
 * Profile screens (20, 21, 23-25) and the staff Profile & identity panel (26-28) are included.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { RICH_MID_JOURNEY } from "../../tests/helpers/student-roadmap-ui-fixtures";
import { ALL_DETAILS, ALL_SUMMARIES, CONTEXT_OPTIONS, INTERNAL_NOTE_TEXT, SUPPORT_NOW, TICKET_AWAITING_STUDENT, TICKET_RESOLVED, toSummary } from "../../tests/helpers/support-ui-fixtures";
import {
  CANONICAL_ADVISOR, CANONICAL_ID, CANONICAL_STUDENT_ROW, canonicalCorrections, canonicalDegreeProgress, canonicalDocumentsApi,
  canonicalProfileView, canonicalStudentMe, canonicalTicketDetails, canonicalWorkspacePayload,
} from "../../tests/helpers/canonical-synthetic-student";
import { queryStaffQueue, staffStats, withOverdue } from "../../tests/helpers/support-queue-sim";
import type { SupportComment, SupportTicketDetail, SupportTicketSummary } from "../../shared/support-contract";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(process.env.S10_SCREENS_OUT ?? path.join(ROOT, "docs/recovery/s10-evidence/screens"));
const PORT = Number(process.env.S10_PORT ?? 5210);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
let rich: any = RICH_MID_JOURNEY;

/** Applies one StudentProgressUpdate (task level) to the fixture view, like the server projection does. */
function applyProgress(view: any, update: { itemKey?: string; taskKey?: string | null; status?: string }): any {
  const next = structuredClone(view);
  for (const phase of next.phases) {
    for (const item of phase.items) {
      if (item.key !== update.itemKey || !update.taskKey || !update.status) continue;
      const task = item.tasks.find((t: any) => t.key === update.taskKey);
      if (!task) continue;
      task.status = update.status;
      task.revision += 1;
      const count = (st: string) => item.tasks.filter((t: any) => t.status === st).length;
      item.taskCounts = { total: item.tasks.length, graded: count("graded"), submitted: count("submitted"), inProgress: count("in_progress"), notStarted: count("not_started") };
    }
  }
  return next;
}

// ---- staff fixtures (derived from the S08 student fixtures + an internal note) ----
const STAFF_ME = CANONICAL_ADVISOR;
const STAFF_STUDENT_ID = CANONICAL_ID;
const NOW = SUPPORT_NOW;
const staffComment = (id: string, ticket_id: string, content: string, hoursAgo: number): SupportComment => ({
  id, ticket_id, author_id: STAFF_ME.id, author_name: STAFF_ME.name, author_role: "staff", author_kind: "staff", content, is_internal: true,
  created_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
});
// Staff view of the canonical tickets. T-2 is staff-side an older, high-priority request so the desk shows a real overdue flag.
const STAFF_DETAILS: SupportTicketDetail[] = canonicalTicketDetails().filter((d) => d.id !== "t-leak").map((d) => ({
  ...d,
  ...(d.id === "t-2" ? { priority: "high" as const, created_at: "2026-10-24T09:00:00.000Z", awaiting_since: "2026-10-24T09:00:00.000Z", last_public_reply_at: "2026-10-24T09:00:00.000Z" } : {}),
  permissions: { can_reply: true, can_attach: true, can_add_internal_note: true, can_assign: true, allowed_statuses: ["in_progress", "waiting_on_student", "resolved", "closed"], can_change_priority: true },
  ticket_comments: d.id === "t-2"
    ? [...d.ticket_comments.map((c) => ({ ...c, created_at: "2026-10-24T09:00:00.000Z" })), staffComment("n1", d.id, "Checked her plan: MKT300 still pending at the provider. Confirm with admissions before promising acceptance.", 2)]
    : d.ticket_comments,
})) as SupportTicketDetail[];
void INTERNAL_NOTE_TEXT; void ALL_DETAILS;
const STAFF_SUMMARIES = withOverdue(STAFF_DETAILS.map((d) => toSummary(d) as SupportTicketSummary), NOW);
const STAFF_DIRECTORY = [STAFF_ME, { id: "coach-1", name: "Jonas Weber", role: "coach" }, { id: "admin-1", name: "Priya Nair", role: "admin" }];

const DOCS = canonicalDocumentsApi();
const PROFILE = canonicalStudentMe();

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

type Mode = "student" | "staff" | "admin";
interface Opts { mode?: Mode; width: number; height: number; theme?: "light" | "dark"; beforeCorrection?: boolean }

async function newPage(browser: any, o: Opts) {
  const mode = o.mode ?? "student";
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  const user = mode === "student"
    ? { id: "u1", email: CANONICAL_STUDENT_ROW.email, name: `${CANONICAL_STUDENT_ROW.first_name} ${CANONICAL_STUDENT_ROW.last_name}`, role: "student" }
    : { id: STAFF_ME.id, email: "camille.moreau@synthetic.example", name: STAFF_ME.name, role: mode === "admin" ? "admin" : "staff" };
  await ctx.clock.setFixedTime(NOW);
  await ctx.addInitScript(() => { (globalThis as any).__name = (f: unknown) => f; });
  await ctx.addInitScript(([theme, u]: [string, unknown]) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
  }, [o.theme ?? "light", user] as [string, unknown]);
  const details: SupportTicketDetail[] = mode === "student" ? [...ALL_DETAILS] : STAFF_DETAILS;
  const summaries: SupportTicketSummary[] = mode === "student" ? [...ALL_SUMMARIES] : STAFF_SUMMARIES;
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    const method = route.request().method();
    if (p === "/api/students/me") return json(200, PROFILE);
    if (p === "/api/students/me/profile") return json(200, canonicalProfileView({ withPendingCorrection: !o.beforeCorrection }));
    if (p === `/api/students/${STAFF_STUDENT_ID}/profile`) return json(200, { ...canonicalProfileView(), account: { role: "staff", twoFactorAvailable: true } });
    if (p === `/api/students/${STAFF_STUDENT_ID}/identity-corrections`) return json(200, canonicalCorrections());
    if (p === `/api/admin/students/${STAFF_STUDENT_ID}/workspace`) return json(200, canonicalWorkspacePayload());
    if (p === "/api/student/roadmap") return json(200, rich);
    if (p === "/api/student/roadmap/progress") {
      // Mirror the real contract: POST returns the authoritative view AFTER the
      // write (proven on real Postgres by tests/s10-consolidated-journey.test.ts),
      // so the row, counts and toast must agree in the screenshot.
      if (method === "POST") rich = applyProgress(rich, JSON.parse(route.request().postData() ?? "{}"));
      return json(200, rich);
    }
    if (p === "/api/student/degree-progress") return json(200, canonicalDegreeProgress());
    if (p.startsWith("/api/documents/student/")) return json(200, DOCS);
    if (p.includes("/contacts")) return json(200, []);
    if (p === "/api/tickets/context-options") return json(200, CONTEXT_OPTIONS);
    if (p === "/api/tickets/stats/summary") return json(200, staffStats(STAFF_SUMMARIES, NOW));
    if (p === "/api/tickets/staff-directory") return json(200, { staff: STAFF_DIRECTORY });
    if (p === "/api/tickets" && method === "GET") {
      // Staff queue honours the same filters as the server (view, awaiting, overdue, assignedTo, search).
      const list = mode === "student" ? summaries : queryStaffQueue(summaries, url.searchParams, NOW, STAFF_ME.id);
      return json(200, { tickets: list, pagination: { total: list.length, limit: 50, offset: 0 } });
    }
    const m = p.match(/^\/api\/tickets\/([^/]+)$/);
    if (m && method === "GET") {
      const d = details.find((x) => x.id === m[1]);
      return d ? json(200, { ticket: d }) : json(404, { error: "Ticket not found", code: "NOT_FOUND" });
    }
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

/** Full-page capture: grow the viewport to the scrollable <main>. Returns the page height. */
async function shot(page: any, name: string): Promise<number> {
  const h = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement | null;
    return Math.max(main ? main.scrollHeight + 150 : 0, document.documentElement.scrollHeight);
  });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 7000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.setViewportSize(vp);
  console.log("wrote", name, h);
  return h;
}

const axeResults: any[] = [];
async function runAxe(page: any, label: string) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    const res = await (window as any).axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n: any) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(0, 3).join(" ") })) }));
  });
  axeResults.push({ screen: label, violations: r });
  console.log("axe", label, r.map((v: any) => `${v.id}(${v.impact})x${v.nodes}`).join(", ") || "clean");
}

async function overflow(page: any) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main") as HTMLElement | null;
    const out: string[] = [];
    if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page scrolls horizontally: ${doc.scrollWidth} > ${doc.clientWidth}`);
    if (main && main.scrollWidth > main.clientWidth + 1) out.push(`main scrolls horizontally: ${main.scrollWidth} > ${main.clientWidth}`);
    return out;
  });
}

async function openTasks(page: any) {
  const toggles = page.locator('[data-testid="item-toggle"]');
  const n = await toggles.count();
  let opened = 0;
  for (let i = 0; i < n && opened < 2; i++) {
    const t = toggles.nth(i);
    if ((await t.isVisible()) && (await t.getAttribute("aria-expanded")) === "false") { await t.click(); opened++; }
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  const D = { width: 1440, height: 900 };
  const M = { width: 390, height: 844 };
  const overflowAudit: any[] = [];
  const metrics: any = { pages: {}, chrome390: {}, toast: null };
  const failures: string[] = [];
  const fd = '[data-testid="flight-deck"]';
  const rm = '[data-testid="roadmap-page"]';
  const sel = (file: string, route: string, o: Opts, waitFor: string, act?: (p: any) => Promise<void>) => ({ file, route, o, waitFor, act });
  const openTicket = async (p: any, text: string) => {
    await settle(p, '[data-testid="ticket-item"]');
    const target = p.locator('[data-testid="ticket-item"]', { hasText: text }).first();
    if (!(await target.isVisible())) await p.locator('[data-testid="group-resolved"] button, [data-testid="group-resolved"] summary').first().click();
    await p.locator('[data-testid="ticket-item"]', { hasText: text }).first().click();
  };
  const staffOpen = async (p: any) => {
    await settle(p, '[data-testid="staff-ticket-row"]');
    await p.locator('[data-testid="staff-ticket-row"]').first().click();
    await settle(p, '[data-testid="internal-note"]');
  };
  const scenarios = [
    sel("01-flight-deck-1440-light.png", "/flight-deck", { ...D }, fd),
    sel("02-flight-deck-390-light.png", "/flight-deck", { ...M }, fd),
    sel("03-flight-deck-1440-dark.png", "/flight-deck", { ...D, theme: "dark" }, fd),
    sel("04-flight-deck-390-dark.png", "/flight-deck", { ...M, theme: "dark" }, fd),
    sel("05-roadmap-1440-light.png", "/roadmap", { ...D }, rm, openTasks),
    sel("06-roadmap-390-light.png", "/roadmap", { ...M }, rm, openTasks),
    sel("07-roadmap-1440-dark.png", "/roadmap", { ...D, theme: "dark" }, rm, openTasks),
    sel("08-roadmap-390-dark.png", "/roadmap", { ...M, theme: "dark" }, rm, openTasks),
    sel("09-support-student-1440-light.png", "/support", { ...D }, '[data-testid="ticket-list"]'),
    sel("10-support-student-conversation-1440-light.png", "/support", { ...D }, '[data-testid="ticket-item"]', async (p) => { await openTicket(p, TICKET_AWAITING_STUDENT.subject); await settle(p, '[data-testid="conversation"]'); }),
    sel("11-support-student-resolved-1440-dark.png", "/support", { ...D, theme: "dark" }, '[data-testid="ticket-item"]', async (p) => { await openTicket(p, TICKET_RESOLVED.subject); await settle(p, '[data-testid="resolution-card"]'); }),
    sel("12-support-student-390-light.png", "/support", { ...M }, '[data-testid="ticket-list"]'),
    sel("13-support-student-conversation-390-light.png", "/support", { ...M }, '[data-testid="ticket-item"]', async (p) => { await openTicket(p, TICKET_AWAITING_STUDENT.subject); await settle(p, '[data-testid="conversation"]'); }),
    sel("14-support-staff-1440-light.png", "/support", { ...D, mode: "staff" }, '[data-testid="staff-ticket-row"]', staffOpen),
    sel("15-support-staff-1440-dark.png", "/support", { ...D, mode: "staff", theme: "dark" }, '[data-testid="staff-ticket-row"]', staffOpen),
    sel("16-support-staff-queue-390-light.png", "/support", { ...M, mode: "staff" }, '[data-testid="staff-ticket-row"]'),
    sel("17-documents-1440-light.png", "/documents", { ...D }, '[data-testid="text-page-title"]'),
    sel("18-documents-390-light.png", "/documents", { ...M }, '[data-testid="text-page-title"]'),
    sel("19-documents-390-dark.png", "/documents", { ...M, theme: "dark" }, '[data-testid="text-page-title"]'),
    sel("20-profile-1440-light.png", "/profile", { ...D }, '[data-testid="profile-header"]'),
    sel("21-profile-390-light.png", "/profile", { ...M }, '[data-testid="profile-header"]'),
    sel("23-profile-1440-dark.png", "/profile", { ...D, theme: "dark" }, '[data-testid="profile-header"]'),
    sel("24-profile-390-dark.png", "/profile", { ...M, theme: "dark" }, '[data-testid="profile-header"]'),
    sel("25-profile-correction-dialog-390-light.png", "/profile", { ...M, beforeCorrection: true }, '[data-testid="button-request-correction"]', async (p) => {
      await p.locator('[data-testid="button-request-correction"]').first().scrollIntoViewIfNeeded();
      await p.locator('[data-testid="button-request-correction"]').first().click();
      await p.waitForSelector('[role="dialog"]');
      await p.waitForTimeout(400);
    }),
    sel("26-staff-profile-panel-1440-light.png", `/admin/students/${STAFF_STUDENT_ID}`, { ...D, mode: "admin" }, "#workspace-profile"),
    sel("27-staff-profile-panel-1440-dark.png", `/admin/students/${STAFF_STUDENT_ID}`, { ...D, mode: "admin", theme: "dark" }, "#workspace-profile"),
    sel("28-staff-profile-panel-768-light.png", `/admin/students/${STAFF_STUDENT_ID}`, { width: 768, height: 900, mode: "admin" }, "#workspace-profile"),
  ];
  try {
    for (const s of scenarios) {
      const { page, ctx } = await newPage(browser, s.o);
      try {
        await page.goto(BASE + s.route);
        await settle(page, s.waitFor);
        if (s.act) await s.act(page);
        const dialogOpen = s.file.startsWith("25");
        const h = dialogOpen ? 0 : await shot(page, s.file);
        if (dialogOpen) await page.screenshot({ path: path.join(OUT, s.file) });
        metrics.pages[s.file] = { pageHeightPx: h };
        const ov = await overflow(page);
        overflowAudit.push({ screen: s.file, width: s.o.width, horizontalOverflow: ov });
        await runAxe(page, s.file);
      } catch (e) {
        failures.push(`${s.file}: ${(e as Error).message}`);
        console.error("FAILED", s.file, (e as Error).message);
        try { await page.screenshot({ path: path.join(OUT, `FAILED-${s.file}`) }); } catch { /* ignore */ }
      } finally {
        await ctx.close();
      }
    }

    // Staff panel: touch-target sizes of the decision buttons (1440) for the report.
    {
      const { page, ctx } = await newPage(browser, { ...D, mode: "admin" });
      await page.goto(`${BASE}/admin/students/${STAFF_STUDENT_ID}`);
      await settle(page, "#workspace-profile");
      metrics.staffPanelButtons = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('#workspace-profile button, #workspace-profile a[href]'))
          .filter((el) => el.getBoundingClientRect().height > 0 && !el.closest("nav"))
          .map((el) => ({ name: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40), height: Math.round(el.getBoundingClientRect().height), width: Math.round(el.getBoundingClientRect().width) })));
      await ctx.close();
    }

    // Sticky chrome at 390 and the toast interaction on the Roadmap.
    {
      const { page, ctx } = await newPage(browser, { ...M });
      await page.goto(BASE + "/roadmap");
      await settle(page, rm);
      metrics.chrome390 = await page.evaluate(() => {
        const header = document.querySelector("header") as HTMLElement | null;
        const stuck: { testid: string | null; height: number; position: string }[] = [];
        document.querySelectorAll("main *").forEach((el) => {
          const cs = getComputedStyle(el);
          if (cs.position === "sticky" || cs.position === "fixed") {
            const b = (el as HTMLElement).getBoundingClientRect();
            if (b.height > 0 && b.width > 200) stuck.push({ testid: el.getAttribute("data-testid"), height: Math.round(b.height), position: cs.position });
          }
        });
        const nav = document.querySelector('[data-testid="student-bottom-nav"]') as HTMLElement | null;
        const stickyTotal = stuck.reduce((n, s) => n + s.height, 0);
        return {
          viewportHeight: innerHeight,
          headerHeight: header ? Math.round(header.getBoundingClientRect().height) : 0,
          stickyInMain: stuck,
          bottomNavHeight: nav ? Math.round(nav.getBoundingClientRect().height) : 0,
          topChromeWhileScrolledPx: (header ? Math.round(header.getBoundingClientRect().height) : 0) + stickyTotal,
        };
      });
      const card = page.locator("article[data-item-key]:has(select:visible)").first();
      const jump = page.locator('[data-testid="now-jump"]');
      if (await jump.count()) { await jump.click(); await page.waitForTimeout(900); }
      if ((await card.count()) > 0) {
        const menu = card.locator("select:not([disabled])").first();
        await menu.scrollIntoViewIfNeeded();
        const menuId = await menu.getAttribute("data-testid");
        await menu.selectOption("graded");
        await page.waitForTimeout(700);
        metrics.toast = await page.evaluate((changedId: string | null) => {
          const r = (el: Element | null) => (el ? (({ top, bottom, left, right }) => ({ top: Math.round(top), bottom: Math.round(bottom), left: Math.round(left), right: Math.round(right) }))(el.getBoundingClientRect()) : null);
          const toast = r(document.querySelector('[data-testid="save-toast"]'));
          // The native select can be visually replaced (0x0 rect); measure its visible wrapper instead.
          const sel = changedId ? document.querySelector(`[data-testid="${changedId}"]`) : null;
          let vis: Element | null = sel;
          while (vis && vis.getBoundingClientRect().height === 0) vis = vis.parentElement;
          const ctl = r(vis);
          const row = changedId ? r(document.querySelector(`[data-testid="${changedId}"]`)?.closest("li, article, [data-testid^='task-row']") ?? null) : null;
          const overlap = (a: any, b: any) => !!a && !!b && a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left;
          return { toast, changedControl: ctl, toastOverlapsChangedControl: overlap(toast, ctl), toastOverlapsChangedRow: overlap(toast, row) };
        }, menuId);
        metrics.toastRowAgrees = await page.evaluate((changedId: string | null) => {
          const sel = changedId ? (document.querySelector(`[data-testid="${changedId}"]`) as HTMLSelectElement | null) : null;
          return { selectValueAfterSave: sel?.value ?? null, toastText: document.querySelector('[data-testid="save-toast"]')?.textContent ?? null };
        }, menuId);
        await page.screenshot({ path: path.join(OUT, "22-roadmap-390-task-saved-toast.png") });
        rich = RICH_MID_JOURNEY; // later scenarios start from the published fixture again
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
  fs.writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify({
    note: "Renders of synthetic fixtures with stubbed auth and API; not a deployment.",
    failures,
    screens: axeResults.length,
    totalViolations: axeResults.reduce((n, r) => n + r.violations.length, 0),
    results: axeResults,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, "overflow-audit.json"), JSON.stringify({ screensWithHorizontalOverflow: overflowAudit.filter((a) => a.horizontalOverflow.length).length, audit: overflowAudit }, null, 2));
  fs.writeFileSync(path.join(OUT, "chrome-metrics.json"), JSON.stringify(metrics, null, 2));
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
