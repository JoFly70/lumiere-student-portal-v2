/**
 * S18 render of the RESTORED ORIGINAL Student Support Center.
 *
 *   npx tsx scripts/s18/render-support-screens.ts
 *
 * LOCAL UI SIMULATION: vite dev server + Playwright route interception. Auth and every /api call are stubbed
 * from SYNTHETIC fixtures (fictional people, @synthetic.example); external hosts are blocked. This is not a
 * deployment and not the owner's original screenshots (those are unavailable). Output goes ONLY to
 * docs/recovery/s18-evidence/screens/ with the `support-` prefix.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ALL_DETAILS, TICKET_AWAITING_STUDENT, TICKET_RESOLVED, TICKET_WITH_CONTEXT, TICKET_WITH_LUMIERE, toSummary, CONTEXT_OPTIONS } from "../../tests/helpers/support-ui-fixtures";
import type { SupportComment, SupportTicketDetail } from "../../shared/support-contract";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s18-evidence/screens");
const PORT = Number(process.env.S18_PORT ?? 5318);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

// ---------------------------------------------------------------------------
// Synthetic fixtures (student view: no internal notes, no emails, no changed_by)
// ---------------------------------------------------------------------------
const ADV = { id: "advisor-1", name: "Camille Moreau" };
const msg = (id: string, ticket: string, kind: "student" | "staff", content: string, at: string): SupportComment => ({
  id, ticket_id: ticket, author_id: kind === "staff" ? "staff" : "student-user-1", author_name: kind === "staff" ? ADV.name : "Amélie Laurent",
  author_role: kind === "staff" ? "staff" : "student", author_kind: kind, content, is_internal: false, created_at: at,
});

const t1: SupportTicketDetail = {
  ...TICKET_AWAITING_STUDENT,
  priority: "high",
  ticket_comments: [
    msg("c-1", "t-1", "student", "I am applying for transfer credit and I am not sure whether to send the provider transcript or the Lumière summary.", "2026-10-25T09:00:00.000Z"),
    msg("c-2", "t-1", "staff", "Thanks Amélie. I am reviewing the courses now. Could you tell me which university you are applying to and the deadline? Then I can confirm exactly what they accept.", "2026-10-25T14:30:00.000Z"),
    msg("c-3", "t-1", "student", "It is the University of Maine at Presque Isle, deadline November 15.", "2026-10-26T08:15:00.000Z"),
    msg("c-4", "t-1", "staff", "Perfect, thank you. They accept the official provider transcript. Please upload it to your Documents and reply here once it is there so I can check it.", "2026-10-26T10:00:00.000Z"),
  ],
  message_count: 4,
  attachment_count: 1,
  ticket_attachments: [
    { id: "a-1", ticket_id: "t-1", comment_id: "c-1", file_name: "provider-transcript.pdf", file_size: 245_000, file_type: "application/pdf", uploaded_by: "student-user-1", uploaded_by_kind: "student", created_at: "2026-10-25T09:01:00.000Z" },
  ],
  ticket_status_history: [
    { id: "h-1", old_status: null, new_status: "open", created_at: "2026-10-25T09:00:00.000Z" },
    { id: "h-2", old_status: "open", new_status: "in_progress", created_at: "2026-10-25T14:00:00.000Z" },
    { id: "h-3", old_status: "in_progress", new_status: "waiting_on_student", created_at: "2026-10-26T10:00:00.000Z" },
  ],
};
const t3: SupportTicketDetail = {
  ...TICKET_RESOLVED,
  ticket_status_history: [
    { id: "h-4", old_status: null, new_status: "open", created_at: "2026-10-14T09:00:00.000Z" },
    { id: "h-5", old_status: "open", new_status: "resolved", created_at: "2026-10-20T09:00:00.000Z" },
  ],
};
const tClosed: SupportTicketDetail = {
  ...TICKET_RESOLVED, id: "t-6", ticket_number: "LP-0950", subject: "Update my mailing address", description: "Please update my mailing address on file.",
  category: "general", topic: "general", status: "closed", resolved_at: "2026-09-02T09:00:00.000Z", updated_at: "2026-09-03T09:00:00.000Z", created_at: "2026-09-01T09:00:00.000Z",
  resolution_notes: "Your address was updated.", ticket_comments: [msg("c-9", "t-6", "student", "Please update my mailing address on file.", "2026-09-01T09:00:00.000Z")],
};
const DETAILS: SupportTicketDetail[] = [
  t1,
  { ...TICKET_WITH_LUMIERE, ticket_status_history: [{ id: "h-6", old_status: null, new_status: "open", created_at: "2026-10-26T08:00:00.000Z" }, { id: "h-7", old_status: "open", new_status: "in_progress", created_at: "2026-10-26T12:00:00.000Z" }] },
  TICKET_WITH_CONTEXT, t3, { ...ALL_DETAILS[3]!, category: "general", topic: "general", description: "Please help me schedule my welcome call." }, tClosed,
];
const SUMMARIES = DETAILS.map(toSummary);

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

interface Opts { width: number; height: number; theme: string }

async function newPage(browser: any, o: Opts, requests: string[]) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  const user = { id: "student-user-1", email: "amelie.laurent@synthetic.example", name: "Amélie Laurent", role: "student" };
  await ctx.addInitScript(([theme, u]: [string, unknown]) => {
    localStorage.setItem("lumiere-portal:theme", theme);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
  }, [o.theme, user] as [string, unknown]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.route(/.*/, async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    requests.push(`${r.method()} ${p}`);
    if (p === "/api/students/me") return json(200, { id: "s1", first_name: "Amélie", last_name: "Laurent", email: user.email, photo_url: null });
    if (p === "/api/tickets/context-options") return json(200, CONTEXT_OPTIONS);
    if (p === "/api/tickets" && r.method() === "GET") return json(200, { tickets: SUMMARIES, pagination: { total: SUMMARIES.length, limit: 100, offset: 0 } });
    if (p === "/api/tickets" && r.method() === "POST") return json(201, { ticket: { ...toSummary(TICKET_WITH_CONTEXT), id: "t-new", ticket_number: "LP-1099" } });
    const m = p.match(/^\/api\/tickets\/([^/]+)$/);
    if (m && r.method() === "GET") {
      const d = DETAILS.find((x) => x.id === m[1]);
      return d ? json(200, { ticket: d }) : json(404, { error: "Ticket not found", code: "NOT_FOUND" });
    }
    return json(404, { error: "not stubbed", code: "STUB_NOT_FOUND" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  page.on("console", (m: any) => { if (m.type() === "error") console.error("console.error:", m.text().slice(0, 200)); });
  return { page, ctx };
}

async function settle(page: any, selector: string) {
  await page.waitForSelector(selector, { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(600);
}

async function fullShot(page: any, name: string) {
  const h = await page.evaluate(() => Math.max((document.querySelector("main") as HTMLElement | null)?.scrollHeight ?? 0, document.documentElement.scrollHeight));
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h + 70, vp.height), 5000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.setViewportSize(vp);
  console.log("wrote", name);
}
async function viewShot(page: any, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log("wrote", name);
}

const axeResults: any[] = [];
async function runAxe(page: any, label: string) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // @ts-expect-error axe is injected into the page
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n: any) => n.target.join(" ")) }));
  });
  axeResults.push({ screen: label, violations: r });
  console.log("axe", label, r.map((v: any) => `${v.id}(${v.impact})x${v.nodes}`).join(", ") || "clean");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  const D = { width: 1440, height: 900, theme: "lumiere" };
  const M = { width: 390, height: 844, theme: "lumiere" };
  const failures: string[] = [];
  const requests: string[] = [];
  const scenario = async (file: string, o: Opts, run: (page: any) => Promise<void>, shot: "full" | "view" = "full") => {
    const { page, ctx } = await newPage(browser, o, requests);
    try {
      await page.goto(BASE + "/support");
      await run(page);
      await (shot === "full" ? fullShot : viewShot)(page, file);
      await runAxe(page, file);
    } catch (e) {
      failures.push(`${file}: ${(e as Error).message}`);
      console.error("FAILED", file, (e as Error).message);
    } finally { await ctx.close(); }
  };
  const list = (p: any) => settle(p, '[data-testid="ticket-list"]');
  const openDetail = async (p: any) => { await list(p); await p.click('[data-testid="button-view-LP-1042"]'); await settle(p, '[data-testid="thread-message"]'); };
  try {
    await scenario("support-01-list-1440.png", D, list);
    await scenario("support-02-expanded-card-1440.png", D, async (p) => { await list(p); await p.click('[data-testid="button-expand-LP-1042"]'); await p.click('[data-testid="button-expand-LP-1060"]'); await p.waitForSelector('[data-testid="ticket-expanded-LP-1042"]'); });
    await scenario("support-03-detail-modal-1440.png", D, openDetail, "view");
    await scenario("support-04-create-dialog-1440.png", D, async (p) => {
      await list(p); await p.click('[data-testid="button-create-ticket"]'); await settle(p, '[data-testid="create-ticket-dialog"]');
      await p.click('[data-testid="select-category"]'); await p.click('[data-testid="topic-option-transcript_document"]');
      await p.fill('[data-testid="input-subject"]', "My transcript upload keeps failing");
      await p.fill('[data-testid="input-description"]', "I try to upload my official transcript on the Documents page but it stops at 80 percent each time.");
      await p.waitForTimeout(300);
    }, "view");
    await scenario("support-05-list-filtered-waiting-1440.png", D, async (p) => { await list(p); await p.click('[data-testid="card-status-waiting_on_student"] button'); await p.waitForTimeout(300); });
    await scenario("support-06-list-390.png", M, list);
    await scenario("support-07-detail-modal-390.png", M, openDetail, "view");
    await scenario("support-08-list-1440-midnight.png", { ...D, theme: "midnight" }, list);
    await scenario("support-09-detail-modal-1440-midnight.png", { ...D, theme: "midnight" }, openDetail, "view");
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
  fs.writeFileSync(path.join(OUT, "support-render-notes.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "Renders of SYNTHETIC fixtures with stubbed auth and API through a local vite dev server. Not a deployment; not the owner's original screenshots (unavailable in this runtime).",
    themes: ["lumiere (default light)", "midnight (Midnight Slate, dark)"],
    failures,
    apiCallsObserved: Array.from(new Set(requests)).sort(),
    axe: axeResults,
  }, null, 2));
  if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
