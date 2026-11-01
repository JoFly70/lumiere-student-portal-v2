/**
 * S30 — LOCAL UI SIMULATION of the Academic Calendar (vite dev server + Playwright route interception; every /api call
 * is stubbed with synthetic data, nothing reaches a server). Screenshots: staff + student, month / week / agenda,
 * 390 / 768 / 1440, light (lumiere) + dark (lumiere-dark), EN + one FR set.
 *
 *   npx tsx scripts/s30/render-calendar-screens.ts <outDir>
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { CalendarItem } from "../../shared/s30-contract";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = process.argv[2] ?? path.join(ROOT, ".s30-shots");
const PORT = Number(process.env.S30_PORT ?? 5283);
const BASE = `http://localhost:${PORT}`;
const NOW = new Date("2026-11-10T15:00:00Z");

const item = (o: Partial<CalendarItem> & Pick<CalendarItem, "id" | "kind" | "start" | "title">): CalendarItem => ({
  source: "calendar_event", studentId: "s-a", studentName: "Ada Synthetic", studentCode: "SYN-001", isDemo: false, titleKey: null, end: null, allDay: true,
  timeZone: "UTC", status: "scheduled", location: null, href: "/admin/students/s-a?tab=overview", editable: false, recordId: "r", ...o,
});
const ITEMS: CalendarItem[] = [
  item({ id: "agreement:s-a:language_test", kind: "academic_deadline", source: "agreement", start: "2026-11-12", title: "Language test", titleKey: "s30.cal.title.language_test" }),
  item({ id: "agreement:s-b:prior_schooling_proof", kind: "document_deadline", source: "agreement", start: "2026-11-06", title: "Proof of prior schooling", titleKey: "s30.cal.title.prior_schooling_proof", status: "overdue", studentId: "s-b", studentName: "Ben Example", studentCode: "SYN-002" }),
  item({ id: "checkpoint:s-a:kickoff_call", kind: "program_checkpoint", source: "checkpoint", start: "2026-11-03", title: "Kickoff call", titleKey: "s30.cal.checkpoint.kickoff_call", status: "done" }),
  item({ id: "orientation:o1", kind: "orientation", source: "orientation", start: "2026-11-11T14:00:00.000Z", end: "2026-11-11T14:30:00.000Z", allDay: false, title: "Orientation session", titleKey: "s30.cal.title.orientation", editable: true, recordId: "o1" }),
  item({ id: "event:e1", kind: "advisor_meeting", start: "2026-11-13T15:00:00.000Z", end: "2026-11-13T15:30:00.000Z", allDay: false, title: "Advisor meeting — semester plan", location: "Video call", editable: true, recordId: "e1", timeZone: "America/Toronto" }),
  item({ id: "event:e2", kind: "support_session", start: "2026-11-17T16:00:00.000Z", end: "2026-11-17T17:00:00.000Z", allDay: false, title: "Study support session", editable: true, recordId: "e2", studentId: "s-b", studentName: "Ben Example", studentCode: "SYN-002" }),
  item({ id: "hsplan:s-b:eng:u2", kind: "course_milestone", source: "high_school_plan", start: "2026-11-12", title: "English 9 — Unit 2 exam", studentId: "s-b", studentName: "Ben Example", studentCode: "SYN-002" }),
  item({ id: "hsplan:s-b:eng:end", kind: "course_milestone", source: "high_school_plan", start: "2026-11-20", title: "English 9", titleKey: "s30.cal.title.courseEnd", studentId: "s-b", studentName: "Ben Example", studentCode: "SYN-002" }),
  item({ id: "hsplan:s-b:alg:u1", kind: "course_milestone", source: "high_school_plan", start: "2026-11-12", title: "Algebra I — Unit 1 quiz", studentId: "s-b", studentName: "Ben Example", studentCode: "SYN-002" }),
  item({ id: "hsplan:s-b:bio:u1", kind: "course_milestone", source: "high_school_plan", start: "2026-11-12", title: "Biology — Lab report", studentId: "s-b", studentName: "Ben Example", studentCode: "SYN-002" }),
  item({ id: "roadmap:s-c:m1", kind: "course_milestone", source: "roadmap", start: "2026-11-25", title: "Capstone proposal ready", studentId: "s-c", studentName: "Chloé Exemple", studentCode: "SYN-003" }),
  item({ id: "event:e3", kind: "advisor_meeting", start: "2026-11-24T13:00:00.000Z", allDay: false, title: "Advisor meeting", status: "cancelled", recordId: "e3" }),
];

function startVite(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "localhost"], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 60_000);
    child.stdout!.on("data", (d) => { if (String(d).includes("Local")) { clearTimeout(timer); resolve(child); } });
    child.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}

async function shoot(browser: any, o: { role: "admin" | "student"; width: number; height: number; theme: string; lang: "en" | "fr"; view: "month" | "week" | "agenda"; name: string }) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, hasTouch: o.width < 500 });
  const user = o.role === "admin" ? { id: "admin-1", email: "owner@synthetic.example", name: "Owner Synthetic", role: "admin" } : { id: "student-user-1", email: "ada@synthetic.example", name: "Ada Synthetic", role: "student" };
  await ctx.addInitScript(([theme, u, lang]: [string, unknown, string]) => {
    localStorage.setItem("lumiere-portal:theme", theme);
    localStorage.setItem("lumiere_language", lang);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: 4102444800 } }));
  }, [o.theme, user, o.lang] as [string, unknown, string]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.clock.setFixedTime(NOW);
  const items = o.role === "student" ? ITEMS.filter((i) => i.studentId === "s-a").map((i) => ({ ...i, studentName: null, studentCode: null, editable: false, href: "/calendar" })) : ITEMS;
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    const p = url.pathname;
    if (!p.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/admin/calendar" || p === "/api/student/calendar") return json(200, { from: url.searchParams.get("from"), to: url.searchParams.get("to"), generatedAt: NOW.toISOString(), truncated: false, items });
    if (p.endsWith("/calendar/subscriptions")) return json(200, { subscriptions: [{ id: "sub-1", scope: o.role === "admin" ? "staff" : "student", privacy: "minimal", label: "Phone", createdAt: "2026-11-01T10:00:00.000Z", lastUsedAt: "2026-11-09T08:00:00.000Z", feedPath: null }] });
    if (p === "/api/admin/control-center") return json(200, { generatedAt: NOW.toISOString(), truncated: false, queue: [], deadlines: [], supportWindows: [], payments: { receivedThisMonthCents: 0, currency: null, signedNotPaid: 0, overdueInstallments: 0 }, counts: { needsYou: 0, flying: 0, deadlines14d: 0, preEnrollment: 0 },
      students: [["s-a", "Ada Synthetic", "SYN-001"], ["s-b", "Ben Example", "SYN-002"], ["s-c", "Chloé Exemple", "SYN-003"]].map(([id, name, code]) => ({ studentId: id, name, code, program: "high_school", isDemo: false, creditsConfirmed: 0, creditsRequired: 21, paceLabel: null, estimatedFinishOn: null, status: { tone: "ok", label: "On track" }, nextDeadline: null, lastActivityOn: null, supportMonthsLeft: null })) });
    if (p === "/api/students/me") return json(200, { id: "s-a", student_code: "SYN-001", first_name: "Ada", last_name: "Synthetic", email: user.email, photo_url: null });
    if (p === "/api/student/programs") return json(200, { programs: [{ kind: "high_school", id: "e1", title: "High School Diploma", status: "active", current: true }] });
    if (p === "/api/student/preferences") return json(200, { language: null });
    if (p === "/api/search") return json(200, { results: [] });
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(e.message));
  await page.goto(BASE + (o.role === "admin" ? "/admin/calendar" : "/calendar"));
  await page.waitForSelector('[data-testid="cal-page"]', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const tab = page.locator(`[data-testid="cal-view-${o.view}-tab"], button:has-text("${o.view === "month" ? (o.lang === "fr" ? "Mois" : "Month") : o.view === "week" ? (o.lang === "fr" ? "Semaine" : "Week") : (o.lang === "fr" ? "Agenda" : "Agenda")}")`).first();
  if (await tab.count()) await tab.click().catch(() => undefined);
  await page.waitForTimeout(600);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const h = await page.evaluate(() => { const m = document.querySelector("main"); return m ? m.scrollHeight + 130 : document.documentElement.scrollHeight; });
  await page.setViewportSize({ width: o.width, height: Math.min(Math.max(o.height, h), 4000) });
  await page.screenshot({ path: path.join(OUT, `${o.name}.png`) });
  await ctx.close();
  return { name: o.name, overflow, errors };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const role of ["admin", "student"] as const) {
      for (const [w, h] of [[1440, 900], [768, 1024], [390, 844]] as const) {
        for (const theme of ["lumiere", "lumiere-dark"]) {
          const views = w === 390 ? (["agenda", "month"] as const) : (["month", "week", "agenda"] as const);
          for (const view of views) results.push(await shoot(browser, { role, width: w, height: h, theme, lang: "en", view, name: `${role}-${w}-${theme}-${view}` }));
        }
      }
      results.push(await shoot(browser, { role, width: 1440, height: 900, theme: "lumiere", lang: "fr", view: "month", name: `${role}-1440-fr-month` }));
      results.push(await shoot(browser, { role, width: 390, height: 844, theme: "lumiere-dark", lang: "fr", view: "agenda", name: `${role}-390-fr-agenda` }));
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { /* gone */ }
  }
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
  for (const r of results) console.log(`${r.name}: overflow=${r.overflow}px errors=${r.errors.length ? r.errors.join(" | ").slice(0, 200) : 0}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
