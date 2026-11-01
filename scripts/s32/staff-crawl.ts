/**
 * S32-B — LOCAL role-aware browser crawl + staff screenshots (vite dev server + Playwright route interception; every
 * /api call is stubbed with SYNTHETIC data built by the real server rule functions; nothing reaches a server).
 *
 *   npx tsx scripts/s32/staff-crawl.ts <outDir> [crawl|shots|all]
 *
 * crawl: as admin, staff and coach, open every link family (Control Center queue + Needs Attention actions, search
 *        result, calendar item, Owner AI citation targets, guardian/document links, back links, the sign-in return)
 *        and record where the browser actually lands. Fails (exit 1) if a staff link lands on the support desk without
 *        being a support link, if any link lands on NotFound, or if an admin-only page renders for staff/coach.
 * shots: Control Center, Student File (overview/documents/billing/sessions), Advanced Workspace, Support desk and the
 *        shell at 390/768/1440, light/dark, EN/FR, with horizontal-overflow measurement.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildControlCenter, ELECTIVE_SUBJECT_PREFIX, type ControlCenterFacts } from "../../server/services/program-journey/control-center";
import { buildAttention, EMPTY_EXTRA } from "../../server/services/s29/rules";
import { DEFAULT_CONCIERGE_SETTINGS } from "../../shared/s29-contract";
import { roleSafeHref, studentFilePath } from "../../shared/staff-links";
import { HS_STUDENT_ID, staffStateRich, staffStateEmpty } from "../../tests/helpers/s11-hs-staff-fixtures";
import { BILLING_CONFIGURED } from "../../tests/helpers/s18-billing-fixtures";
import { staffReviewProfile } from "../../tests/helpers/s09-profile-ui-fixtures";
import { ALL_SUMMARIES, TICKET_WITH_LUMIERE } from "../../tests/helpers/support-ui-fixtures";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = process.argv[2] ?? path.join(ROOT, ".s32-shots");
const MODE = (process.argv[3] ?? "all") as "crawl" | "shots" | "all";
const PORT = Number(process.env.S32_PORT ?? 5293);
const BASE = `http://localhost:${PORT}`;
const NOW = new Date("2026-11-11T15:00:00Z");

const HS = HS_STUDENT_ID;
const DEG = "44444444-4444-4444-8444-444444444444";
const LEAD = "55555555-5555-4555-8555-555555555555";
const TICKET = TICKET_WITH_LUMIERE.id;

const ccFacts: ControlCenterFacts = {
  students: [
    { id: HS, code: "SYN-001", name: "Ada Synthetic", preferredName: null, userId: "u-hs" },
    { id: DEG, code: "SYN-002", name: "Ben Example", preferredName: null, userId: "u-deg" },
    { id: LEAD, code: "SYN-003", name: "Chloé Exemple", preferredName: null, userId: null },
  ],
  enrollments: [{ id: "e1", studentId: HS, status: "active", requiredHalfUnits: 42, startedOn: "2026-06-01", createdAt: "2026-06-01T00:00:00Z", content: null }],
  progress: [], awards: [], results: [],
  agreements: [{ studentId: HS, signedOn: "2026-10-20", activatedOn: null, supportMonths: 9, accessMonths: 36, languageTestDays: 30, priorSchoolingDays: 90, languageTestStatus: "open", languageTestDoneOn: null, priorSchoolingStatus: "open", priorSchoolingDoneOn: null }],
  pendingDocuments: [{ studentId: HS, count: 2 }, { studentId: DEG, count: 1 }],
  evidenceAwaiting: [{ studentId: HS, count: 1 }],
  billing: [], receiptsThisMonth: [],
  tickets: [
    { id: TICKET, studentId: HS, subject: "Question about my plan", status: "open", createdAt: "2026-11-10T10:00:00Z" },
    { id: "t-elective", studentId: DEG, subject: `${ELECTIVE_SUBJECT_PREFIX} Swap course`, status: "open", createdAt: "2026-11-10T10:00:00Z" },
  ],
  sessionRequests: [{ id: "sr1", studentId: HS, slotAt: "2026-11-20T15:00:00Z" }],
  degrees: [{ studentId: DEG }],
  truncated: false,
};
const cc = buildControlCenter(ccFacts, NOW);
const attentionCandidates = buildAttention(ccFacts, {
  ...EMPTY_EXTRA,
  pendingImports: [{ id: "b1", sourceKind: "provider_progress", rows: 3, students: 1, validatedAt: "2026-11-09T00:00:00Z" }],
  readyToLink: [{ studentId: LEAD, accountCreatedAt: "2026-11-10T00:00:00Z" }],
  failedNotifications: [{ id: "n1", studentId: HS, template: "support.reply", at: "2026-11-10T00:00:00Z" }],
}, DEFAULT_CONCIERGE_SETTINGS, NOW).items;
const attention = {
  generatedAt: NOW.toISOString(), source: "store", lastSyncAt: NOW.toISOString(), recentlyClosed: [],
  items: attentionCandidates.map((c) => ({ ...c, status: "open", detectedAt: NOW.toISOString(), lastSeenAt: NOW.toISOString(), resolvedAt: null, resolvedBy: null, resolution: null, snoozedUntil: null })),
  counts: { open: attentionCandidates.length, urgent: attentionCandidates.filter((c) => c.priority === "urgent").length, high: attentionCandidates.filter((c) => c.priority === "high").length, dueThisWeek: 2, closed7d: 1 },
};

const studentRecord = (id: string) => {
  const [first, last, code, status] = id === HS ? ["Ada", "Synthetic", "SYN-001", "active"] : id === DEG ? ["Ben", "Example", "SYN-002", "active"] : ["Chloé", "Exemple", "SYN-003", "lead"];
  return { id, first_name: first, last_name: last, preferred_name: null, email: `${first.toLowerCase()}@synthetic.example`, student_code: code, status, photo_url: null, user_id: id === LEAD ? null : `u-${id}` };
};
const staffBilling = { student: BILLING_CONFIGURED, obligationNote: null, discounts: [], receipts: [], evidence: [], voidedReceipts: [], voidedDiscounts: [], scheduledCents: (BILLING_CONFIGURED as { netObligationCents?: number }).netObligationCents ?? 0, scheduleMismatchCents: 0, actorNames: {} };
const agreement = { signedOn: "2026-10-20", activatedOn: null, supportMonths: 9, supportEndsOn: null, supportMonthsLeft: null, accessMonths: 36, accessEndsOn: null, deadlines: [], orientationSessionsIncluded: 2, orientationSessionsUsed: 0, goal: null, languageTestDays: 30, priorSchoolingDays: 90 };
const sessions = [{ id: "sr1", studentId: HS, slotAt: "2026-11-20T15:00:00+00:00", status: "requested", notes: null, prep: {}, createdAt: "2026-11-10T10:00:00Z" }];
const accountView = (id: string) => id === LEAD
  ? { studentId: id, studentEmail: "chloé@synthetic.example", linked: false, account: null, candidates: [{ userId: "u-new", email: "chloé@synthetic.example", name: "Chloé", createdAt: "2026-11-10T00:00:00Z" }], invitation: { state: "accepted", sentAt: "2026-11-08T00:00:00Z", expiresAt: "2026-11-11T00:00:00Z", acceptedAt: "2026-11-10T00:00:00Z" }, enrollment: { stage: "ready_to_link", next: "link_account", candidateCount: 1 } }
  : { studentId: id, studentEmail: studentRecord(id).email, linked: true, account: { userId: `u-${id}`, email: studentRecord(id).email, role: "student" }, candidates: [], invitation: { state: "accepted", sentAt: "2026-06-01T00:00:00Z", expiresAt: "2026-06-04T00:00:00Z", acceptedAt: "2026-06-02T00:00:00Z" }, enrollment: { stage: "linked", next: "none", candidateCount: 0 } };
const tickets = { tickets: ALL_SUMMARIES.map((t) => ({ ...t, student_id: HS })), total: ALL_SUMMARIES.length, pagination: { total: ALL_SUMMARIES.length } };

type Role = "admin" | "staff" | "coach";
const USERS: Record<Role, { id: string; email: string; name: string; role: Role }> = {
  admin: { id: "admin-1", email: "owner@synthetic.example", name: "Owner Synthetic", role: "admin" },
  staff: { id: "staff-1", email: "staff@synthetic.example", name: "Sam Staff", role: "staff" },
  coach: { id: "coach-1", email: "coach@synthetic.example", name: "Cora Coach", role: "coach" },
};

function apiFor(role: Role, url: URL, unknown: Set<string>): { status: number; body: unknown } {
  const p = url.pathname;
  const ok = (body: unknown) => ({ status: 200, body });
  const forbidden = { status: 403, body: { error: "Forbidden" } };
  const adminOnly = (body: unknown) => (role === "admin" ? ok(body) : forbidden);
  const sid = /^\/api\/(?:admin\/)?students\/([^/]+)/.exec(p)?.[1] ?? /^\/api\/documents\/student\/([^/?]+)/.exec(p)?.[1] ?? "";
  if (p === "/api/admin/control-center") return role === "coach" ? forbidden : ok(cc);
  if (p === "/api/admin/s29/attention") return role === "coach" ? forbidden : ok(attention);
  if (p.startsWith("/api/staff/preferences") || p.startsWith("/api/student/preferences")) return ok({ language: null });
  if (p === "/api/search") return role === "coach" ? ok({ results: [] }) : ok({ results: [{ type: "student", id: HS, title: "Ada Synthetic", subtitle: "SYN-001", path: `/admin/students/${HS}`, score: 1 }] });
  if (p === "/api/admin/directory/students") return role === "coach" ? forbidden : ok({ facts: [HS, DEG, LEAD].map((id) => ({ studentId: id, program: id === HS ? { kind: "high_school", title: "High School Diploma (21 credits)" } : id === DEG ? { kind: "degree", title: "BS Business Administration" } : null, billing: { overdue: id === HS, balanceCents: 120000, currency: "USD" }, lastActivityOn: "2026-11-09" })) });
  if (p === "/api/students") return role === "coach" ? forbidden : ok({ students: [HS, DEG, LEAD].map(studentRecord), total: 3, pagination: { total: 3 } });
  if (p === "/api/admin/documents/queue") return ok({ documents: [{ studentId: HS }, { studentId: HS }] });
  if (p === "/api/admin/billing/awaiting-evidence") return ok({ students: [{ studentId: HS, count: 1 }] });
  if (/^\/api\/students\/[^/]+$/.test(p)) return role === "coach" ? forbidden : ok(studentRecord(sid));
  if (/^\/api\/students\/[^/]+\/profile$/.test(p)) return ok({ ...staffReviewProfile(), identity: { ...staffReviewProfile().identity, studentId: sid } });
  if (/^\/api\/students\/[^/]+\/identity-corrections$/.test(p)) return ok({ requests: [] });
  if (/\/high-school$/.test(p)) return ok(sid === HS ? staffStateRich() : staffStateEmpty());
  if (/\/workspace$/.test(p)) return role === "admin" ? { status: 404, body: { error: { code: "WORKSPACE_NOT_FOUND", message: "No workspace" } } } : forbidden;
  if (/\/account$/.test(p)) return adminOnly(accountView(sid));
  if (/\/activity$/.test(p)) return adminOnly({ events: [] });
  if (/\/billing$/.test(p) && p.startsWith("/api/admin/students/")) return ok(staffBilling);
  if (/\/journey$/.test(p)) return ok({ agreement, checkpoints: [], sessions, pace: null });
  if (/\/agreement$/.test(p)) return ok({ agreement });
  if (/\/orientation-sessions$/.test(p)) return ok({ sessions });
  if (/\/notes$/.test(p)) return ok({ notes: [] });
  if (/\/owner-assistant\/status$/.test(p)) return adminOnly({ live: false });
  if (p.startsWith("/api/documents/student/")) return ok([{ id: "d1", student_id: sid, doc_type: "hs_transcript", file_name: "transcript.pdf", status: "pending", uploaded_at: "2026-11-08T10:00:00Z", file_size: 120000, mime_type: "application/pdf" }]);
  if (p.includes("/reported-records")) return ok({ records: [] });
  if (p === "/api/tickets/stats/summary") return ok({ open: 2, needsResponse: 1, unassigned: 1, overdue: 0, resolved7d: 3 });
  if (p === "/api/tickets/staff-directory") return ok({ staff: [{ id: "staff-1", name: "Sam Staff", role: "staff" }] });
  if (p === "/api/tickets/context-options") return ok({ options: [] });
  if (p === "/api/tickets") return ok(tickets);
  if (/^\/api\/tickets\/[^/]+$/.test(p)) return ok({ ...TICKET_WITH_LUMIERE, ...(role === "coach" ? {} : { student_id: HS }) });
  if (p === "/api/admin/calendar") return ok({ from: url.searchParams.get("from"), to: url.searchParams.get("to"), generatedAt: NOW.toISOString(), truncated: false, items: [] });
  if (p.endsWith("/calendar/subscriptions")) return ok({ subscriptions: [] });
  unknown.add(p);
  return { status: 404, body: { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } } };
}

function startVite(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "localhost"], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 90_000);
    child.stdout!.on("data", (d) => { if (String(d).includes("Local")) { clearTimeout(timer); resolve(child); } });
    child.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}

async function context(browser: any, role: Role | null, o: { width: number; height: number; theme: string; lang: "en" | "fr" }, unknown: Set<string>) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, hasTouch: o.width < 500 });
  await ctx.addInitScript(([theme, u, lang]: [string, unknown, string]) => {
    localStorage.setItem("lumiere-portal:theme", theme);
    localStorage.setItem("lumiere_language", lang);
    if (u) localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: 4102444800 } }));
  }, [o.theme, role ? USERS[role] : null, o.lang] as [string, unknown, string]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.clock.setFixedTime(NOW);
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/csrf-token") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ csrfToken: "stub" }) });
    if (!role) return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Unauthorized" }) });
    const r = apiFor(role, url, unknown);
    return route.fulfill({ status: r.status, contentType: "application/json", body: JSON.stringify(r.body) });
  });
  return ctx;
}

interface CrawlRow { role: Role; family: string; from: string; landed: string; ok: boolean; why?: string }

async function settle(page: any) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(500);
}

async function crawl(browser: any, unknown: Set<string>): Promise<CrawlRow[]> {
  const rows: CrawlRow[] = [];
  const links: Array<{ family: string; href: string; support?: boolean }> = [
    ...cc.queue.map((q) => ({ family: `control-center:${q.kind}`, href: q.href, support: q.kind === "support_reply" || q.kind === "elective_approval" })),
    ...attention.items.map((i) => ({ family: `needs-attention:${i.kind}`, href: i.href, support: i.kind === "support_reply" || i.kind === "elective_approval" })),
    { family: "search:student", href: `/admin/students/${HS}` },
    { family: "calendar:open", href: `/admin/students/${HS}?tab=overview` },
    { family: "owner-ai:guardian", href: `/admin/students/${HS}/workspace#profile` },
    { family: "owner-ai:tickets", href: `/support?studentId=${HS}`, support: true },
    { family: "owner-ai:ticket", href: `/support?ticket=${TICKET}`, support: true },
    { family: "hs:documents", href: studentFilePath(HS, "documents") },
    { family: "hs:back-to-file", href: `/admin/students/${HS}/high-school` },
    { family: "roadmap:back-to-file", href: `/admin/students/${DEG}/roadmap` },
    { family: "directory", href: "/admin/students" },
    { family: "imports", href: "/admin/imports?batch=b1" },
    { family: "email-delivery", href: "/admin/notifications?state=failed" },
  ];
  for (const role of ["admin", "staff", "coach"] as const) {
    const ctx = await context(browser, role, { width: 1440, height: 900, theme: "lumiere", lang: "en" }, unknown);
    const page = await ctx.newPage();
    for (const l of links) {
      const target = roleSafeHref(l.href, role); // what the page's link renders for this role
      await page.goto(BASE + target);
      await settle(page);
      const landed = new URL(page.url());
      const where = landed.pathname + landed.search + landed.hash;
      const notFound = await page.locator("text=/404|Page Not Found|page introuvable/i").count();
      const notice = await page.locator('[data-testid="access-notice"]').count();
      let ok = notFound === 0 && notice === 0;
      let why = notFound ? "NotFound" : notice ? "redirected with access notice" : undefined;
      if (role === "staff" && !l.support && landed.pathname === "/support") { ok = false; why = "staff bounced to the support desk"; }
      if (role === "coach" && landed.pathname !== "/support") { ok = false; why = "coach left the support desk"; }
      rows.push({ role, family: l.family, from: target, landed: where, ok, ...(why ? { why } : {}) });
    }
    // Admin-only pages must not render for staff / coach.
    for (const adminOnlyPath of [`/admin/students/${HS}/workspace`, "/admin/assistant", "/admin", "/admin/diagnostics"]) {
      if (role === "admin") continue;
      await page.goto(BASE + adminOnlyPath);
      await settle(page);
      const landed = new URL(page.url()).pathname;
      rows.push({ role, family: "admin-only-guard", from: adminOnlyPath, landed, ok: landed !== adminOnlyPath, ...(landed === adminOnlyPath ? { why: "admin-only page rendered" } : {}) });
    }
    // Click-through: the first Needs Attention "Open" button lands on the item's page, not the Control Center.
    if (role !== "coach") {
      await page.goto(BASE + (role === "admin" ? "/admin/support-center" : "/staff/control-center"));
      await page.waitForSelector('[data-testid="needs-attention"]', { timeout: 20_000 }).catch(() => undefined);
      const btn = page.locator('[data-testid="attention-open"]').first();
      if (await btn.count()) {
        await btn.click();
        await settle(page);
        const landed = new URL(page.url());
        const ok = !/control-center|support-center/.test(landed.pathname) && (role === "admin" || landed.pathname !== "/support");
        rows.push({ role, family: "click:needs-attention-open", from: "first item", landed: landed.pathname + landed.search, ok });
      }
      // The ring's "Open the queue" anchor targets an element that exists.
      await page.goto(BASE + (role === "admin" ? "/admin/support-center" : "/staff/control-center"));
      await page.waitForSelector('[data-testid="kpi-needs"]', { timeout: 20_000 }).catch(() => undefined);
      const href = await page.locator('[data-testid="kpi-needs"] a').first().getAttribute("href").catch(() => null);
      const exists = href ? await page.locator(href).count() : 0;
      rows.push({ role, family: "anchor:needs-ring", from: href ?? "(none)", landed: exists ? "element found" : "missing", ok: exists > 0 });
    }
    await ctx.close();
  }
  // Return to destination after sign-in: open a protected page signed out, then sign in.
  {
    const ctx = await context(browser, null, { width: 1440, height: 900, theme: "lumiere", lang: "en" }, unknown);
    const page = await ctx.newPage();
    const want = `/admin/students/${HS}?tab=documents`;
    await page.goto(BASE + want);
    await settle(page);
    const stored = await page.evaluate(() => sessionStorage.getItem("lumiere_return_to"));
    const onLogin = new URL(page.url()).pathname === "/login";
    rows.push({ role: "staff", family: "return-to:remembered", from: want, landed: `${new URL(page.url()).pathname} (stored ${stored})`, ok: onLogin && stored === want });
    await ctx.close();
  }
  return rows;
}

const SHOTS: Array<{ role: Role; path: string; name: string; ready: string; click?: string }> = [
  { role: "admin", path: "/admin/support-center", name: "cc-admin", ready: '[data-testid="control-center"]' },
  { role: "staff", path: "/staff/control-center", name: "cc-staff", ready: '[data-testid="control-center"]' },
  { role: "staff", path: `/admin/students/${HS}`, name: "file-staff-overview", ready: '[data-testid="admin-student-file"]' },
  { role: "admin", path: `/admin/students/${LEAD}`, name: "file-admin-lead-enrollment", ready: '[data-testid="ov-enrollment"]' },
  { role: "staff", path: `/admin/students/${HS}?tab=documents`, name: "file-staff-documents", ready: '[data-testid="documents-tab"]' },
  { role: "staff", path: `/admin/students/${HS}?tab=sessions`, name: "file-staff-sessions", ready: '[data-testid="sessions-tab"]' },
  { role: "admin", path: `/admin/students/${LEAD}/workspace`, name: "workspace-admin", ready: '[data-testid="admin-student-workspace"]' },
  { role: "staff", path: "/admin/students", name: "directory-staff", ready: '[data-testid="admin-students"]' },
  { role: "staff", path: `/support?studentId=${HS}`, name: "support-staff-student", ready: "main" },
  { role: "coach", path: "/support", name: "support-coach", ready: "main" },
];

async function shots(browser: any, unknown: Set<string>) {
  const out: Array<{ name: string; overflow: number; errors: string[] }> = [];
  const variants: Array<{ width: number; height: number; theme: string; lang: "en" | "fr" }> = [
    { width: 1440, height: 900, theme: "lumiere", lang: "en" },
    { width: 1440, height: 900, theme: "lumiere", lang: "fr" },
    { width: 768, height: 1024, theme: "lumiere-dark", lang: "fr" },
    { width: 390, height: 844, theme: "lumiere-dark", lang: "en" },
    { width: 390, height: 844, theme: "lumiere", lang: "fr" },
  ];
  for (const s of SHOTS) {
    for (const v of variants) {
      const ctx = await context(browser, s.role, v, unknown);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.goto(BASE + s.path);
      await page.waitForSelector(s.ready, { timeout: 30_000 }).catch(() => errors.push(`not ready: ${s.ready}`));
      await settle(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const h = await page.evaluate(() => { const m = document.querySelector("main"); return m ? m.scrollHeight + 130 : document.documentElement.scrollHeight; });
      await page.setViewportSize({ width: v.width, height: Math.min(Math.max(v.height, h), 4200) });
      const name = `${s.name}-${v.width}-${v.theme}-${v.lang}`;
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      out.push({ name, overflow, errors });
      await ctx.close();
    }
  }
  return out;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const unknown = new Set<string>();
  let failed = false;
  try {
    if (MODE !== "shots") {
      const rows = await crawl(browser, unknown);
      fs.writeFileSync(path.join(OUT, "crawl.json"), JSON.stringify(rows, null, 2));
      for (const r of rows) console.log(`${r.ok ? "PASS" : "FAIL"} ${r.role.padEnd(5)} ${r.family.padEnd(36)} ${r.from} -> ${r.landed}${r.why ? `  (${r.why})` : ""}`);
      const bad = rows.filter((r) => !r.ok);
      console.log(`crawl: ${rows.length - bad.length}/${rows.length} passed`);
      if (bad.length) failed = true;
    }
    if (MODE !== "crawl") {
      const res = await shots(browser, unknown);
      fs.writeFileSync(path.join(OUT, "shots.json"), JSON.stringify(res, null, 2));
      for (const r of res) console.log(`${r.name}: overflow=${r.overflow}px errors=${r.errors.length ? r.errors.join(" | ").slice(0, 200) : 0}`);
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { /* gone */ }
  }
  if (unknown.size) console.log(`unstubbed API paths: ${[...unknown].sort().join(", ")}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
