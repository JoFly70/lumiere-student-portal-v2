/**
 * Renders the real Support Center (student and staff modes) in Chromium from
 * synthetic fixtures and writes PNGs plus an axe-core summary to docs/s08/screens/.
 *
 *   npx tsx scripts/s08/render-support-screens.ts
 *
 * Auth and every /api call are stubbed (nothing here talks to a real backend);
 * external fonts are blocked. These are renders of fixtures, not of a deployment.
 * Student fixtures come from tests/helpers/support-ui-fixtures.ts; staff
 * fixtures (queue, internal note, permissions) are built below.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  ALL_DETAILS, ALL_SUMMARIES, CONTEXT_OPTIONS, TICKET_AWAITING_STUDENT, TICKET_RESOLVED, TICKET_WITH_CONTEXT, TICKET_WITH_LUMIERE, toSummary,
} from "../../tests/helpers/support-ui-fixtures";
import type { SupportComment, SupportTicketDetail, SupportTicketSummary } from "../../shared/support-contract";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = process.env.S08_SCREENS_OUT ? path.resolve(process.env.S08_SCREENS_OUT) : path.join(ROOT, "docs/s08/screens");
const PORT = Number(process.env.S08_PORT ?? 5193);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

// ---------------------------------------------------------------------------
// Staff fixtures (synthetic)
// ---------------------------------------------------------------------------
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const STAFF_ME = { id: "staff-1", name: "Camille Moreau", role: "staff" as const };
const COACH = { id: "coach-1", name: "Jonas Weber", role: "coach" as const };
const STAFF_DIRECTORY = [STAFF_ME, COACH, { id: "admin-1", name: "Priya Nair", role: "admin" as const }];

function staffTicket(o: Partial<SupportTicketDetail> & Pick<SupportTicketDetail, "id" | "ticket_number" | "subject" | "reporter_name">): SupportTicketDetail {
  const base = TICKET_WITH_LUMIERE;
  return {
    ...base,
    description: "Synthetic description.",
    reporter_email: `${o.reporter_name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]+/g, ".")}@synthetic.example`,
    assigned_to: o.assignee?.id ?? null,
    assignee: null,
    status: "open",
    awaiting: "staff",
    awaiting_since: hoursAgo(5),
    created_at: hoursAgo(5),
    updated_at: hoursAgo(5),
    is_overdue: false,
    message_count: 1,
    ticket_comments: [],
    permissions: { can_reply: true, can_attach: true, can_add_internal_note: true, can_assign: true, allowed_statuses: ["in_progress", "waiting_on_student", "resolved", "closed"], can_change_priority: true },
    ...o,
  } as SupportTicketDetail;
}

const comment = (id: string, ticket_id: string, kind: "student" | "staff", name: string, content: string, hours: number, internal = false): SupportComment => ({
  id, ticket_id, author_id: kind === "staff" ? STAFF_ME.id : "stu", author_name: name, author_role: kind === "staff" ? "staff" : "student",
  author_kind: kind, content, is_internal: internal, created_at: hoursAgo(hours),
});

const STAFF_DETAILS: SupportTicketDetail[] = [
  staffTicket({
    id: "s-1", ticket_number: "LUM-10231", subject: "Which transcript should I send to the university?", reporter_name: "Amélie Laurent",
    category: "enrollment", topic: "transfer_credit", priority: "high", status: "in_progress", assignee: STAFF_ME, assigned_to: STAFF_ME.id,
    awaiting_since: hoursAgo(30), created_at: hoursAgo(52), is_overdue: true, message_count: 4,
    context: { kind: "roadmap_item", itemKey: "course-mkt-101", title: "Marketing Fundamentals", code: "MKT 101", itemKind: "course", planVersion: 3, verifiedAt: hoursAgo(52) },
    ticket_comments: [
      comment("m1", "s-1", "student", "Amélie Laurent", "I am applying for transfer credit and I am not sure whether to send the provider transcript or the Lumière summary.", 52),
      comment("m2", "s-1", "staff", STAFF_ME.name, "Thanks Amélie. Could you tell me which university and the deadline?", 40),
      comment("m3", "s-1", "student", "Amélie Laurent", "It is the University of Maine at Presque Isle, deadline November 15.", 30),
      comment("m4", "s-1", "staff", STAFF_ME.name, "Checked her plan: MKT 101 still pending at the provider. Confirm with admissions before promising acceptance.", 29, true),
    ],
  }),
  staffTicket({ id: "s-2", ticket_number: "LUM-10244", subject: "Cannot open my course dashboard", reporter_name: "Noah Fischer", category: "technical", topic: "account_technical", priority: "urgent", awaiting_since: hoursAgo(9), is_overdue: true, assignee: null }),
  staffTicket({ id: "s-3", ticket_number: "LUM-10250", subject: "Invoice for September", reporter_name: "Lina Okafor", category: "billing", topic: "billing", priority: "medium", status: "waiting_on_student", awaiting: "student", assignee: COACH, assigned_to: COACH.id, awaiting_since: hoursAgo(20) }),
  staffTicket({ id: "s-4", ticket_number: "LUM-10253", subject: "Question about Marketing Fundamentals pacing", reporter_name: "Mateo Rossi", category: "academic", topic: "course_assistance", priority: "low", assignee: null, awaiting_since: hoursAgo(2) }),
  staffTicket({ id: "s-5", ticket_number: "LUM-10198", subject: "Welcome call scheduling", reporter_name: "Sara Haddad", category: "general", topic: "general", status: "resolved", awaiting: "none", resolution_notes: "Your welcome call took place on October 21.", assignee: STAFF_ME, assigned_to: STAFF_ME.id }),
];
const staffSummaries = STAFF_DETAILS.map((d) => toSummary(d) as SupportTicketSummary);
const STAFF_STATS = { stats: { byStatus: { open: 2, in_progress: 1, waiting_on_student: 1, resolved: 1, closed: 0 }, byCategory: {}, awaitingStaff: 3, awaitingStudent: 1, overdue: 2, unassigned: 2, avgResolutionHours: 18, resolvedLast30Days: 6 } };

// ---------------------------------------------------------------------------
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

type Mode = "student" | "staff";
interface Opts { mode: Mode; width: number; height: number; theme?: "light" | "dark" }

async function newPage(browser: any, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  const user = o.mode === "student"
    ? { id: "student-user-1", email: "amelie.laurent@synthetic.example", name: "Amélie Laurent", role: "student" }
    : { id: STAFF_ME.id, email: "camille.moreau@synthetic.example", name: STAFF_ME.name, role: "staff" };
  await ctx.addInitScript(([theme, u]: [string, unknown]) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
  }, [o.theme ?? "light", user] as [string, unknown]);
  const details: SupportTicketDetail[] = o.mode === "student" ? [...ALL_DETAILS] : STAFF_DETAILS;
  const summaries = o.mode === "student" ? [...ALL_SUMMARIES] : staffSummaries;
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === "/api/students/me") return json(200, { id: "s1", first_name: "Amélie", last_name: "Laurent", email: user.email, photo_url: null });
    if (p === "/api/tickets/context-options") return json(200, CONTEXT_OPTIONS);
    if (p === "/api/tickets/stats/summary") return json(200, STAFF_STATS);
    if (p === "/api/tickets/staff-directory") return json(200, { staff: STAFF_DIRECTORY });
    if (p === "/api/tickets" && route.request().method() === "GET") return json(200, { tickets: summaries, pagination: { total: summaries.length, limit: 50, offset: 0 } });
    const m = p.match(/^\/api\/tickets\/([^/]+)$/);
    if (m && route.request().method() === "GET") {
      const d = details.find((x) => x.id === m[1]);
      return d ? json(200, { ticket: d }) : json(404, { error: "Ticket not found", code: "NOT_FOUND" });
    }
    return json(404, { error: "not stubbed", code: "STUB_NOT_FOUND" });
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

async function shot(page: any, name: string) {
  const h = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement | null;
    return Math.max(main ? main.scrollHeight + 70 : 0, document.documentElement.scrollHeight);
  });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 5000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.setViewportSize(vp);
  console.log("wrote", name);
}

const results: any[] = [];
async function runAxe(page: any, label: string) {
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
  const D = { width: 1440, height: 900 };
  const M = { width: 390, height: 844 };
  const failures: string[] = [];
  const scenario = async (file: string, o: Opts, run: (page: any) => Promise<void>) => {
    const { page, ctx } = await newPage(browser, o);
    try {
      await page.goto(BASE + "/support");
      await run(page);
      await shot(page, file);
      await runAxe(page, file);
    } catch (e) {
      failures.push(`${file}: ${(e as Error).message}`);
      console.error("FAILED", file, (e as Error).message);
      try { await page.screenshot({ path: path.join(OUT, `FAILED-${file}`) }); } catch { /* ignore */ }
    } finally {
      await ctx.close();
    }
  };
  const open = async (page: any, text: string) => {
    await settle(page, '[data-testid="ticket-item"]');
    // Resolved requests sit in a collapsed disclosure: open it when the target is not visible.
    const target = page.locator('[data-testid="ticket-item"]', { hasText: text }).first();
    if (!(await target.isVisible())) await page.locator('[data-testid="group-resolved"] button, [data-testid="group-resolved"] summary').first().click();
    await page.locator('[data-testid="ticket-item"]', { hasText: text }).first().click();
  };
  try {
    await scenario("01-student-overview-1440.png", { mode: "student", ...D }, (p) => settle(p, '[data-testid="ticket-list"]'));
    await scenario("02-student-awaiting-you-1440.png", { mode: "student", ...D }, async (p) => { await open(p, TICKET_AWAITING_STUDENT.subject); await settle(p, '[data-testid="conversation"]'); });
    await scenario("03-student-new-request-1440.png", { mode: "student", ...D }, async (p) => { await settle(p, '[data-testid="button-new-request"]'); await p.click('[data-testid="button-new-request"]'); await settle(p, '[data-testid="new-request-form"]'); });
    await scenario("04-student-resolved-outcome-1440.png", { mode: "student", ...D }, async (p) => { await open(p, TICKET_RESOLVED.subject); await settle(p, '[data-testid="resolution-card"]'); });
    await scenario("05-student-context-1440.png", { mode: "student", ...D }, async (p) => { await open(p, TICKET_WITH_CONTEXT.subject); await settle(p, '[data-testid="conversation"]'); });
    await scenario("06-student-overview-390.png", { mode: "student", ...M }, (p) => settle(p, '[data-testid="ticket-list"]'));
    await scenario("07-student-conversation-390.png", { mode: "student", ...M }, async (p) => { await open(p, TICKET_AWAITING_STUDENT.subject); await settle(p, '[data-testid="conversation"]'); });
    await scenario("08-staff-queue-conversation-1440.png", { mode: "staff", ...D }, async (p) => {
      await settle(p, '[data-testid="staff-ticket-row"]');
      await p.locator('[data-testid="staff-ticket-row"]', { hasText: "Which transcript" }).first().click();
      await settle(p, '[data-testid="internal-note"]');
    });
    await scenario("09-staff-queue-390.png", { mode: "staff", ...M }, (p) => settle(p, '[data-testid="staff-ticket-row"]'));
    await scenario("10-staff-conversation-390.png", { mode: "staff", ...M }, async (p) => {
      await settle(p, '[data-testid="staff-ticket-row"]');
      await p.locator('[data-testid="staff-ticket-row"]', { hasText: "Which transcript" }).first().click();
      await settle(p, '[data-testid="internal-note"]');
    });
    await scenario("11-staff-queue-conversation-1440-dark.png", { mode: "staff", ...D, theme: "dark" }, async (p) => {
      await settle(p, '[data-testid="staff-ticket-row"]');
      await p.locator('[data-testid="staff-ticket-row"]', { hasText: "Which transcript" }).first().click();
      await settle(p, '[data-testid="internal-note"]');
    });
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
  fs.writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "Renders of synthetic fixtures with stubbed auth and API; not a deployment.",
    failures,
    totalViolations: results.reduce((n, r) => n + r.violations.length, 0),
    results,
  }, null, 2));
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
