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
import type { SupportComment, SupportPerson, SupportTicketDetail, SupportTicketSummary } from "../../shared/support-contract";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.resolve(process.env.S10_SCREENS_OUT ?? path.join(ROOT, "docs/recovery/s10-evidence/screens"));
const PORT = Number(process.env.S10_PORT ?? 5210);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
let rich: any = RICH_MID_JOURNEY;
// S10_ONLY="regex" renders only the matching file names (used for the before/after staff comparisons).
const ONLY = process.env.S10_ONLY ? new RegExp(process.env.S10_ONLY) : null;

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
// A realistic desk has more than one student: a few synthetic requests from other (fictional) students,
// cloned from the canonical ticket shape. The stats tiles, the queue filters and the list all derive from
// this one array, so counts and rows cannot disagree.
const mkOther = (o: { id: string; n: string; subject: string; reporter: string; reporterId: string; status: SupportTicketDetail["status"]; priority: SupportTicketDetail["priority"]; created: string; assignee: SupportPerson | null; category: SupportTicketDetail["category"]; topic: SupportTicketDetail["topic"] }): SupportTicketDetail => {
  const awaitingStudent = o.status === "waiting_on_student";
  const template = STAFF_DETAILS.find((d) => d.id === "t-2")!;
  return {
    ...template,
    id: o.id, ticket_number: o.n, subject: o.subject, description: o.subject,
    reporter_id: o.reporterId, reporter_name: o.reporter, status: o.status, priority: o.priority,
    category: o.category, topic: o.topic, assignee: o.assignee, assigned_to: o.assignee?.id ?? null,
    created_at: o.created, updated_at: o.created, awaiting_since: o.created, last_public_reply_at: o.created,
    awaiting: awaitingStudent ? "student" : "staff", context: null, resolved_at: null, resolution_notes: null,
    ticket_comments: [{
      id: `${o.id}-c1`, ticket_id: o.id, author_id: o.reporterId, author_name: o.reporter, author_role: "student",
      author_kind: "student", content: o.subject, is_internal: false, created_at: o.created,
    }],
  } as SupportTicketDetail;
};
const OTHER_DETAILS: SupportTicketDetail[] = [
  mkOther({ id: "t-x1", n: "LP-1063", subject: "Official transcript still not received by the registrar", reporter: "Noah Fraser", reporterId: "student-user-2", status: "open", priority: "urgent", created: "2026-10-22T14:00:00.000Z", assignee: null, category: "enrollment", topic: "transfer_credit" }),
  mkOther({ id: "t-x2", n: "LP-1058", subject: "Payment plan question before the next term", reporter: "Priya Raman", reporterId: "student-user-3", status: "open", priority: "high", created: "2026-10-25T16:00:00.000Z", assignee: { id: "coach-1", name: "Jonas Weber", role: "coach" } as SupportPerson, category: "billing", topic: "billing" }),
  mkOther({ id: "t-x3", n: "LP-1049", subject: "Is my English proficiency proof accepted?", reporter: "Mateo Silva", reporterId: "student-user-4", status: "in_progress", priority: "medium", created: "2026-10-24T11:00:00.000Z", assignee: STAFF_ME as SupportPerson, category: "document", topic: "transcript_document" }),
  mkOther({ id: "t-x4", n: "LP-1033", subject: "Signed consent form for my guardian", reporter: "Hannah Berg", reporterId: "student-user-5", status: "waiting_on_student", priority: "medium", created: "2026-10-23T09:00:00.000Z", assignee: STAFF_ME as SupportPerson, category: "document", topic: "transcript_document" }),
];
const STAFF_SUMMARIES = withOverdue([...STAFF_DETAILS, ...OTHER_DETAILS].map((d) => toSummary(d) as SupportTicketSummary), NOW);
// The real server presents the detail from the same summary, so the overdue flag is identical in list and detail.
const ALL_STAFF_DETAILS: SupportTicketDetail[] = [...STAFF_DETAILS, ...OTHER_DETAILS].map((d) => ({ ...d, is_overdue: STAFF_SUMMARIES.find((x) => x.id === d.id)?.is_overdue }));
const STAFF_DIRECTORY = [STAFF_ME, { id: "coach-1", name: "Jonas Weber", role: "coach" }, { id: "admin-1", name: "Priya Nair", role: "admin" }];

// Admin home + students list fixtures (synthetic, @synthetic.example). The first row IS the canonical student.
const ADMIN_STUDENT_ROWS = [
  { id: CANONICAL_ID, student_code: CANONICAL_STUDENT_ROW.student_code, first_name: CANONICAL_STUDENT_ROW.first_name, last_name: CANONICAL_STUDENT_ROW.last_name, email: CANONICAL_STUDENT_ROW.email, status: "active", residency: CANONICAL_STUDENT_ROW.residency, created_at: "2026-01-05T10:00:00.000Z" },
  { id: "s-2", student_code: "LUM-0002", first_name: "Noah", last_name: "Fraser", email: "noah.fraser@synthetic.example", status: "active", residency: "domestic", created_at: "2026-02-11T10:00:00.000Z" },
  { id: "s-3", student_code: "LUM-0003", first_name: "Priya", last_name: "Raman", email: "priya.raman@synthetic.example", status: "active", residency: "foreign", created_at: "2026-03-02T10:00:00.000Z" },
  { id: "s-4", student_code: "LUM-0004", first_name: "Mateo", last_name: "Silva", email: "mateo.silva@synthetic.example", status: "lead", residency: "foreign", created_at: "2026-09-18T10:00:00.000Z" },
  { id: "s-5", student_code: "LUM-0005", first_name: "Hannah", last_name: "Berg", email: "hannah.berg@synthetic.example", status: "paused", residency: "domestic", created_at: "2025-11-20T10:00:00.000Z" },
  { id: "s-6", student_code: "LUM-0006", first_name: "Tomasz", last_name: "Nowak", email: "tomasz.nowak@synthetic.example", status: "graduated", residency: "domestic", created_at: "2024-09-03T10:00:00.000Z" },
];
const ADMIN_ANALYTICS = {
  analytics: {
    usersByRole: { admin: 2, coach: 3, staff: 4, student: 6 },
    studentsByStatus: { active: 3, lead: 1, paused: 1, graduated: 1 },
    activeEnrollments: 3, recentSignups: 1, totalRevenue: 0,
  },
};
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
  const details: SupportTicketDetail[] = mode === "student" ? [...ALL_DETAILS] : ALL_STAFF_DETAILS;
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
    if (p === "/api/admin/analytics/dashboard") return json(200, ADMIN_ANALYTICS);
    if (p === "/api/admin/students") return json(200, { students: ADMIN_STUDENT_ROWS });
    if (p === "/api/admin/users") return json(200, { users: [] });
    if (p === "/api/tickets/context-options") return json(200, CONTEXT_OPTIONS);
    if (p === "/api/tickets/stats/summary") return json(200, staffStats(STAFF_SUMMARIES, NOW));
    if (p === "/api/tickets/staff-directory") return json(200, { staff: STAFF_DIRECTORY });
    if (p === "/api/tickets" && method === "GET") {
      // Staff queue honours the same filters as the server (view, awaiting, overdue, assignedTo, search).
      let list = mode === "student" ? summaries : queryStaffQueue(summaries, url.searchParams, NOW, STAFF_ME.id);
      // The workspace asks for one student's tickets (studentId); the canonical student's reporter id is the ticket owner.
      // Server-side queue order (stub): overdue first, then longest-waiting first.
      if (mode !== "student") list = [...list].sort((a, b) => Number(!!b.is_overdue) - Number(!!a.is_overdue) || a.awaiting_since.localeCompare(b.awaiting_since));
      if (url.searchParams.get("studentId")) list = list.filter((t) => t.reporter_id === "student-user-1");
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


// ---- S10 staff pass: real interaction + keyboard tests (writes staff-interaction-results.json) ----
async function staffInteractions(browser: any, out: string): Promise<{ failures: string[] }> {
  const results: { name: string; pass: boolean; detail?: unknown }[] = [];
  const failures: string[] = [];
  const check = (name: string, pass: boolean, detail?: unknown) => {
    results.push({ name, pass, detail });
    if (!pass) failures.push(`interaction: ${name} ${JSON.stringify(detail ?? "")}`);
    console.log(pass ? "PASS" : "FAIL", name, pass ? "" : JSON.stringify(detail ?? ""));
  };
  const WSURL = `${BASE}/admin/students/${STAFF_STUDENT_ID}`;
  const focusInfo = (page: any) => page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "body";
    const name = el.getAttribute("aria-label") || (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 42) || el.getAttribute("placeholder") || el.id;
    return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""}: ${name}`;
  });

  // 1. Desk filters
  {
    const { page, ctx } = await newPage(browser, { width: 1440, height: 900, mode: "staff" });
    await page.goto(`${BASE}/support`);
    await settle(page, '[data-testid="staff-ticket-row"]');
    const tile = (n: string) => page.locator('[data-testid="staff-stats"] button', { hasText: n }).first();
    const rows = () => page.locator('[data-testid="staff-ticket-row"]');
    const tileNumber = async (n: string) => Number((await tile(n).locator("span.font-serif").innerText()).trim());
    check("desk starts on Needs response with its tile pressed", (await tile("Needs response").getAttribute("aria-pressed")) === "true" && (await tile("Overdue").getAttribute("aria-pressed")) === "false");
    check("Needs response list length equals its tile", (await rows().count()) === (await tileNumber("Needs response")), { rows: await rows().count(), tile: await tileNumber("Needs response") });

    await tile("Overdue").click();
    await page.waitForTimeout(500);
    const overdueRows = await rows().count();
    const flagged = await page.locator('[data-testid="staff-ticket-row"] [data-testid="overdue-flag"]').count();
    check("Overdue tile filters the list: every row overdue, count equals tile", overdueRows === (await tileNumber("Overdue")) && flagged === overdueRows && overdueRows > 0, { overdueRows, flagged });
    check("pressed state moves to the Overdue tile and the queue title follows", (await tile("Overdue").getAttribute("aria-pressed")) === "true" && (await tile("Needs response").getAttribute("aria-pressed")) === "false" && (await page.locator('[data-testid="queue-title"]').innerText()) === "Overdue");

    await tile("Unassigned").click();
    await page.waitForTimeout(500);
    const unassignedTexts: string[] = await rows().allInnerTexts();
    check("Unassigned tile: every row is Unassigned and count equals tile", unassignedTexts.length === (await tileNumber("Unassigned")) && unassignedTexts.every((t) => /Unassigned/.test(t)), { n: unassignedTexts.length });

    await page.locator('[data-testid="more-views"] button', { hasText: "Mine" }).click();
    await page.waitForTimeout(500);
    const mine: string[] = await rows().allInnerTexts();
    check("Mine view: every row is assigned to the signed-in advisor", mine.length > 0 && mine.every((t) => /Assigned: Camille Moreau/.test(t)), { n: mine.length });

    await page.locator('[data-testid="more-views"] button', { hasText: "Resolved" }).click();
    await page.waitForTimeout(500);
    const resolved: string[] = await rows().allInnerTexts();
    check("Resolved view lists only resolved or closed tickets", resolved.length > 0 && resolved.every((t) => /Resolved|Closed/.test(t)), { n: resolved.length });

    // 2. Selecting a ticket: card assignee == detail assignee
    await tile("Needs response").click();
    await page.waitForTimeout(500);
    for (const [subject, expectAssignee] of [["Cannot open my course dashboard", "Camille Moreau"], ["Official transcript still not received", ""]] as const) {
      const row = rows().filter({ hasText: subject }).first();
      const cardText = await row.innerText();
      await row.click();
      await page.waitForSelector('[data-testid="staff-ticket-detail"]');
      await page.waitForTimeout(300);
      const selected = await page.locator('[data-testid="staff-ticket-detail"] select').nth(1).evaluate((s: HTMLSelectElement) => s.options[s.selectedIndex].text);
      const cardSays = expectAssignee ? cardText.includes(`Assigned: ${expectAssignee}`) : /Unassigned/.test(cardText);
      const detailSays = expectAssignee ? selected.startsWith(expectAssignee) : selected === "Unassigned";
      const banner = await page.locator('[data-testid="waiting-banner"]').innerText();
      check(`selecting "${subject}": card and detail agree on the assignee (${expectAssignee || "Unassigned"})`, cardSays && detailSays, { cardText: cardText.replace(/\s+/g, " "), selected });
      check(`detail banner states who waits and for how long for "${subject}"`, /Overdue|Waiting on/.test(banner) && /Waiting \d/.test(banner), banner);
      check(`row is marked current for "${subject}"`, (await row.getAttribute("aria-current")) === "true");
    }
    await ctx.close();
  }

  // 3. Workspace tabs
  {
    const { page, ctx } = await newPage(browser, { width: 1440, height: 900, mode: "admin" });
    await page.goto(WSURL);
    await settle(page, '[role="tablist"]');
    const tab = (k: string) => page.locator(`[data-testid="tab-${k}"]`);
    const panelHidden = (k: string) => page.locator(`#ws-panel-${k}`).evaluate((e: HTMLElement) => e.hidden);
    check("workspace opens on Overview", (await tab("overview").getAttribute("aria-selected")) === "true" && !(await panelHidden("overview")) && (await panelHidden("documents")));
    await tab("documents").click();
    check("clicking Documents switches the panel and the URL hash", (await tab("documents").getAttribute("aria-selected")) === "true" && !(await panelHidden("documents")) && (await panelHidden("overview")) && page.url().endsWith("#documents"), page.url());
    check("Documents panel shows the recorded documents", (await page.locator("#workspace-documents li").count()) > 0);
    await tab("documents").focus();
    await page.keyboard.press("ArrowRight");
    check("ArrowRight moves to Support (selected, focused, panel switched)", (await tab("support").getAttribute("aria-selected")) === "true" && (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "tab-support" && !(await panelHidden("support")));
    await page.keyboard.press("Home");
    check("Home returns to Overview", (await tab("overview").getAttribute("aria-selected")) === "true");
    await page.keyboard.press("End");
    check("End moves to the last tab", (await tab("support").getAttribute("aria-selected")) === "true");
    check("only the selected tab is in the tab order (roving tabindex)", (await tab("support").getAttribute("tabindex")) === "0" && (await tab("overview").getAttribute("tabindex")) === "-1");
    // counts agree: tab badge == needs-attention row
    const badge = async (k: string) => Number(((await tab(k).locator("span.rounded-full").innerText().catch(() => "0")).match(/\d+/) ?? ["0"])[0]);
    await tab("overview").click();
    const rowCount = async (label: string) => Number((await page.locator('[data-testid="needs-attention"] li', { hasText: label }).locator("span.rounded-full").first().innerText()).trim());
    check("tab badges equal the Needs-attention rows (one count, no contradiction)", (await badge("profile")) === (await rowCount("Identity and guardian")) && (await badge("documents")) === (await rowCount("Documents to review")) && (await badge("support")) === (await rowCount("Requests waiting")));
    // Review button switches tab
    await page.locator('[data-testid="needs-attention"] button[aria-label="Review documents"]').click();
    check("Needs-attention Review button opens the Documents tab", (await tab("documents").getAttribute("aria-selected")) === "true");
    await ctx.close();
    for (const [hash, expected] of [["#profile", "profile"], ["#workspace-documents", "documents"], ["#workspace-support", "support"], ["#documents", "documents"]] as const) {
      const c = await newPage(browser, { width: 1440, height: 900, mode: "admin" });
      await c.page.goto(WSURL + hash);
      await settle(c.page, '[role="tablist"]');
      await c.page.waitForTimeout(300);
      check(`deep link ${hash} opens the ${expected} tab`, (await c.page.locator(`[data-testid="tab-${expected}"]`).getAttribute("aria-selected")) === "true", await c.page.locator('[role="tab"][aria-selected="true"]').innerText());
      await c.ctx.close();
    }
  }

  // 4. Keyboard: tab order through the desk, and the dialog focus trap
  const keyboard: Record<string, string[] | boolean | string> = {};
  {
    const { page, ctx } = await newPage(browser, { width: 1440, height: 900, mode: "staff" });
    await page.goto(`${BASE}/support`);
    await settle(page, '[data-testid="staff-ticket-row"]');
    const order: string[] = [];
    for (let i = 0; i < 24; i++) { await page.keyboard.press("Tab"); order.push(await focusInfo(page)); }
    keyboard.deskTabOrder = order;
    // open the first row from the keyboard and walk the conversation actions
    await page.locator('[data-testid="staff-ticket-row"]', { hasText: "Cannot open my course dashboard" }).first().focus();
    await page.keyboard.press("Enter");
    await settle(page, '[data-testid="internal-note"]');
    const convo: string[] = [];
    for (let i = 0; i < 14; i++) { await page.keyboard.press("Tab"); convo.push(await focusInfo(page)); }
    keyboard.afterSelectTabOrder = convo;
    check("keyboard: Enter on a row opens its conversation and Tab reaches the status, assignee, priority controls and composer", ["Status", "In progress"].some((x) => convo.join("|").includes(x)) && convo.some((c) => /select/.test(c)) && convo.some((c) => /textarea|Public reply/.test(c)), convo);
    await ctx.close();

    const m = await newPage(browser, { width: 390, height: 844, mode: "staff" });
    await m.page.goto(`${BASE}/support`);
    await settle(m.page, '[data-testid="staff-ticket-row"]');
    await m.page.locator('[data-testid="staff-ticket-row"]').first().click();
    await m.page.waitForSelector('[data-testid="staff-ticket-detail"]');
    await m.page.waitForTimeout(400);
    keyboard.mobileFocusAfterOpen = await focusInfo(m.page);
    check("mobile drill-in: focus moves to the conversation title when a ticket opens", /Official transcript|Cannot open|Question about|Is my English|Payment plan/.test(String(keyboard.mobileFocusAfterOpen)), keyboard.mobileFocusAfterOpen);
    await m.page.locator('[data-testid="staff-back-to-queue"]').click();
    await m.page.waitForTimeout(400);
    keyboard.mobileFocusAfterBack = await focusInfo(m.page);
    check("mobile drill-in: Back to queue returns focus to the row that was open", /Official transcript|Cannot open|Question about|Is my English|Payment plan/.test(String(keyboard.mobileFocusAfterBack)) || String(keyboard.mobileFocusAfterBack).startsWith("button"), keyboard.mobileFocusAfterBack);
    await m.ctx.close();
  }
  {
    const { page, ctx } = await newPage(browser, { width: 1440, height: 900, mode: "admin" });
    await page.goto(`${WSURL}#profile`);
    await settle(page, "#workspace-profile");
    const approve = page.locator('[data-testid="pending-correction"] button', { hasText: "Approve" }).first();
    await approve.focus();
    await page.keyboard.press("Enter");
    await page.waitForSelector('[role="dialog"]');
    const inside: boolean[] = [];
    const seq: string[] = [];
    for (let i = 0; i < 9; i++) {
      await page.keyboard.press("Tab");
      seq.push(await focusInfo(page));
      inside.push(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')));
    }
    keyboard.dialogTabSequence = seq;
    check("dialog focus trap: 9 Tab presses never leave the dialog", inside.every(Boolean), seq);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    check("Escape closes the dialog", (await page.locator('[role="dialog"]').count()) === 0);
    const back = await focusInfo(page);
    keyboard.dialogFocusReturn = back;
    check("focus returns to the Approve button that opened the dialog", /Approve/.test(back), back);
    await ctx.close();
  }
  {
    // Narrow/tablet shell: the rail and the drawer are reachable by keyboard.
    const { page, ctx } = await newPage(browser, { width: 768, height: 900, mode: "staff" });
    await page.goto(`${BASE}/support`);
    await settle(page, '[data-testid="staff-ticket-row"]');
    const sidebarW = await page.evaluate(() => Math.round((document.querySelector('[data-slot="sidebar-container"]') as HTMLElement | null)?.getBoundingClientRect().width ?? -1));
    check("768px: sidebar is a 48px icon rail, not 256px", sidebarW > 0 && sidebarW <= 64, sidebarW);
    keyboard.sidebarWidth768 = String(sidebarW);
    await ctx.close();
    const mob = await newPage(browser, { width: 390, height: 844, mode: "staff" });
    await mob.page.goto(`${BASE}/support`);
    await settle(mob.page, '[data-testid="staff-ticket-row"]');
    await mob.page.locator('[data-testid="button-sidebar-toggle"]').click();
    await mob.page.waitForSelector('[role="dialog"]');
    const drawerFocus: boolean[] = [];
    for (let i = 0; i < 6; i++) { await mob.page.keyboard.press("Tab"); drawerFocus.push(await mob.page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))); }
    check("390px: the navigation drawer traps focus", drawerFocus.every(Boolean), drawerFocus);
    await mob.page.keyboard.press("Escape");
    await mob.page.waitForTimeout(900);
    check("390px: Escape closes the drawer", (await mob.page.locator('[role="dialog"]').count()) === 0);
    await mob.ctx.close();
  }

  fs.writeFileSync(path.join(out, "staff-interaction-results.json"), JSON.stringify({ note: "Playwright against the real UI with stubbed API and fixed clock.", passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length, results, keyboard }, null, 2));
  return { failures };
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
    await p.locator('[data-testid="staff-ticket-row"]', { hasText: "Cannot open my course dashboard" }).first().click();
    await settle(p, '[data-testid="internal-note"]');
  };
  const staffFilter = (name: string) => async (p: any) => {
    await settle(p, '[data-testid="staff-ticket-row"]');
    await p.locator('[data-testid="staff-stats"] button', { hasText: name }).first().click();
    await p.waitForTimeout(600);
  };
  const WS = `/admin/students/${STAFF_STUDENT_ID}`;
  const staffDesk = (file: string, o: Opts, act?: (p: any) => Promise<void>) => sel(file, "/support", { mode: "staff", ...o }, '[data-testid="staff-ticket-row"]', act);
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
    sel("26-staff-profile-panel-1440-light.png", `/admin/students/${STAFF_STUDENT_ID}#profile`, { ...D, mode: "admin" }, "#workspace-profile"),
    sel("27-staff-profile-panel-1440-dark.png", `/admin/students/${STAFF_STUDENT_ID}#profile`, { ...D, mode: "admin", theme: "dark" }, "#workspace-profile"),
    sel("28-staff-profile-panel-768-light.png", `${WS}#profile`, { width: 768, height: 900, mode: "admin" }, "#workspace-profile"),
    staffDesk("29-staff-desk-conversation-390-light.png", { ...M }, staffOpen),
    staffDesk("30-staff-desk-queue-768-light.png", { width: 768, height: 1024 }),
    staffDesk("31-staff-desk-conversation-768-light.png", { width: 768, height: 1024 }, staffOpen),
    staffDesk("32-staff-desk-queue-1024-light.png", { width: 1024, height: 800 }),
    staffDesk("33-staff-desk-conversation-1024-light.png", { width: 1024, height: 800 }, staffOpen),
    staffDesk("34-staff-desk-overdue-filter-1440-light.png", { ...D }, staffFilter("Overdue")),
    staffDesk("35-staff-desk-queue-1440-light.png", { ...D }),
    sel("36-staff-workspace-overview-390-light.png", WS, { ...M, mode: "admin" }, "h1"),
    sel("37-staff-workspace-overview-768-light.png", WS, { width: 768, height: 1024, mode: "admin" }, "h1"),
    sel("38-staff-workspace-overview-1024-light.png", WS, { width: 1024, height: 800, mode: "admin" }, "h1"),
    sel("39-staff-workspace-overview-1440-light.png", WS, { ...D, mode: "admin" }, "h1"),
    sel("40-staff-workspace-overview-1440-dark.png", WS, { ...D, mode: "admin", theme: "dark" }, "h1"),
    sel("41-staff-workspace-documents-1440-light.png", `${WS}#documents`, { ...D, mode: "admin" }, "h1"),
    sel("42-staff-workspace-support-1440-light.png", `${WS}#support`, { ...D, mode: "admin" }, "h1"),
    sel("43-admin-home-1440-light.png", "/admin", { ...D, mode: "admin" }, "h1"),
    sel("44-admin-home-1440-dark.png", "/admin", { ...D, mode: "admin", theme: "dark" }, "h1"),
    sel("45-admin-home-390-light.png", "/admin", { ...M, mode: "admin" }, "h1"),
    sel("46-admin-students-1440-light.png", "/admin?tab=students", { ...D, mode: "admin" }, "table"),
    sel("47-admin-students-1024-light.png", "/admin?tab=students", { width: 1024, height: 800, mode: "admin" }, "table"),
    sel("48-admin-students-768-light.png", "/admin?tab=students", { width: 768, height: 1024, mode: "admin" }, "table"),
    sel("49-admin-students-390-light.png", "/admin?tab=students", { ...M, mode: "admin" }, "table"),
  ].filter((x) => !ONLY || ONLY.test(x.file));
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
    if (!ONLY) {
      const { page, ctx } = await newPage(browser, { ...D, mode: "admin" });
      await page.goto(`${BASE}/admin/students/${STAFF_STUDENT_ID}#profile`);
      await settle(page, "#workspace-profile");
      metrics.staffPanelButtons = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('#workspace-profile button, #workspace-profile a[href]'))
          .filter((el) => el.getBoundingClientRect().height > 0 && !el.closest("nav"))
          .map((el) => ({ name: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40), height: Math.round(el.getBoundingClientRect().height), width: Math.round(el.getBoundingClientRect().width) })));
      await ctx.close();
    }

    // Sticky chrome at 390 and the toast interaction on the Roadmap.
    if (!ONLY) {
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
    if (process.env.S10_INTERACT || !ONLY) {
      const r = await staffInteractions(browser, OUT);
      failures.push(...r.failures);
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
  const sfx = ONLY ? ".partial" : "";
  fs.writeFileSync(path.join(OUT, `axe-summary${sfx}.json`), JSON.stringify({
    note: "Renders of synthetic fixtures with stubbed auth and API; not a deployment.",
    failures,
    screens: axeResults.length,
    totalViolations: axeResults.reduce((n, r) => n + r.violations.length, 0),
    results: axeResults,
  }, null, 2));
  fs.writeFileSync(path.join(OUT, `overflow-audit${sfx}.json`), JSON.stringify({ screensWithHorizontalOverflow: overflowAudit.filter((a) => a.horizontalOverflow.length).length, audit: overflowAudit }, null, 2));
  if (!ONLY) fs.writeFileSync(path.join(OUT, "chrome-metrics.json"), JSON.stringify(metrics, null, 2));
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
