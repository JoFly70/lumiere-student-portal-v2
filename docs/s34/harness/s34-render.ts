/**
 * S34 copy of the S32-A harness. S34_PROGRAMS_429=1 makes /api/student/programs answer 429 (Retry-After 60).
 * S32-A LOCAL UI SIMULATION (adapted from the S31-A harness) (not live): vite dev server + Playwright route interception.
 * Auth and every /api call are stubbed from SYNTHETIC repo fixtures. External hosts blocked. No backend writes.
 *   npx tsx <this> <mode> <outDir>     mode: matrix | probe | journeys
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const R = process.env.S32_ROOT ?? path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const require = createRequire(R + "/package.json");
const { chromium } = require("playwright");
import { BILLING_CONFIGURED } from "../../../tests/helpers/s18-billing-fixtures";
import { RICH_PROFILE } from "../../../tests/helpers/s09-profile-ui-fixtures";
import { S27_DOCS, s27HsView, s27Journey } from "../../../tests/helpers/s27-fixtures";
import { RICH_MID_JOURNEY } from "../../../tests/helpers/student-roadmap-ui-fixtures";
import { COMPOSED } from "../../../tests/helpers/student-progress-ui-fixtures";

const OUT = process.argv[3] ?? "/tmp/s32-out";
const MODE = process.argv[2] ?? "probe";
const PORT = Number(process.env.S31_PORT ?? 5392);
const BASE = `http://localhost:${PORT}`;
const NOW = new Date("2026-10-29T18:30:00");

type Persona = "hs" | "ba";
const SCREENS: Record<string, { path: string; personas: Persona[] }> = {
  "flight-deck": { path: "/flight-deck", personas: ["hs", "ba"] },
  "hs-roadmap": { path: "/high-school", personas: ["hs"] },
  roadmap: { path: "/roadmap", personas: ["ba"] },
  beyond: { path: "/beyond", personas: ["hs", "ba"] },
  calendar: { path: "/calendar", personas: ["hs", "ba"] },
  notifications: { path: "/notifications", personas: ["hs"] },
  library: { path: "/library", personas: ["hs"] },
  documents: { path: "/documents", personas: ["hs"] },
  billing: { path: "/billing", personas: ["hs"] },
  support: { path: "/support", personas: ["hs"] },
  profile: { path: "/profile", personas: ["hs"] },
};

const calItem = (o: any) => ({ source: "calendar_event", studentId: "s1", studentName: null, studentCode: null, isDemo: false, titleKey: null, end: null, allDay: true, timeZone: "UTC", status: "scheduled", location: null, href: "/calendar", editable: false, recordId: "r", ...o });
const CAL = [
  calItem({ id: "agreement:s1:language_test", kind: "academic_deadline", source: "agreement", start: "2026-11-12", title: "Language test", titleKey: "s30.cal.title.language_test" }),
  calItem({ id: "checkpoint:s1:kickoff_call", kind: "program_checkpoint", source: "checkpoint", start: "2026-11-03", title: "Kickoff call", titleKey: "s30.cal.checkpoint.kickoff_call", status: "done" }),
  calItem({ id: "orientation:o1", kind: "orientation", source: "orientation", start: "2026-11-11T14:00:00.000Z", end: "2026-11-11T14:30:00.000Z", allDay: false, title: "Orientation session", titleKey: "s30.cal.title.orientation" }),
  calItem({ id: "event:e1", kind: "advisor_meeting", start: "2026-11-13T15:00:00.000Z", end: "2026-11-13T15:30:00.000Z", allDay: false, title: "Advisor meeting — semester plan", location: "Video call" }),
  calItem({ id: "hsplan:s1:eng:u2", kind: "course_milestone", source: "high_school_plan", start: "2026-11-05", title: "English 9 — Unit 2 exam" }),
];
const NOTIFS = { notifications: [
  { id: "n1", kind: "calendar.reminder", templateKey: "calendar.deadline_soon", title: "Language test in 3 days", body: "Your language test deadline is on 12 November.", href: "/calendar", readAt: null, createdAt: "2026-10-29T10:00:00Z", severity: "info" },
  { id: "n2", kind: "document.rejected", templateKey: "document.rejected", title: "Document needs attention", body: "Your proof of prior schooling could not be accepted.", href: "/documents", readAt: null, createdAt: "2026-10-28T10:00:00Z", severity: "attention" },
  { id: "n3", kind: "support.reply", templateKey: "support.reply", title: "New reply on SUP-0001", body: "Lumière replied to your request.", href: "/support", readAt: "2026-10-27T10:00:00Z", createdAt: "2026-10-27T10:00:00Z", severity: "info" },
], unreadCount: 2 };

export const unstubbed = new Map<string, Set<string>>();

function startVite(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "localhost"], {
    cwd: R, env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 90_000);
    child.stdout!.on("data", (d) => { if (String(d).includes("Local")) { clearTimeout(timer); resolve(child); } });
    child.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}

interface Opts { width: number; height: number; theme: "lumiere" | "lumiere-dark"; lang: "en" | "fr"; persona: Persona; screen: string }
export const posts: { url: string; method: string; body: any }[] = [];

async function newPage(browser: any, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, hasTouch: o.width < 500, isMobile: o.width < 500 });
  const user = o.persona === "hs"
    ? { id: "student-user-1", email: "noa@synthetic.example", name: "Noa Synthétique", role: "student" }
    : { id: "student-user-2", email: "avery@synthetic.example", name: "Avery Synthetic", role: "student" };
  await ctx.addInitScript(([theme, u, lang]: [string, unknown, string]) => {
    localStorage.setItem("lumiere-portal:theme", theme);
    localStorage.setItem("lumiere_language", lang);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: 4102444800 } }));
  }, [o.theme, user, o.lang] as [string, unknown, string]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.clock.setFixedTime(NOW);
  const hs = s27HsView();
  const journey = s27Journey();
  await ctx.route(/.*/, async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.hostname !== "localhost") return route.abort();
    const p = url.pathname;
    if (!p.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const body = r.method() === "GET" ? undefined : JSON.parse(r.postData() || "{}");
    if (r.method() !== "GET") posts.push({ url: p, method: r.method(), body });
    if (p === "/api/student/programs" && process.env.S34_PROGRAMS_429) return route.fulfill({ status: 429, contentType: "application/json", headers: { "Retry-After": "60" }, body: JSON.stringify({ error: "Too many requests. Please wait a minute and try again.", code: "rate_limited", scope: "user", retryAfter: 60 }) });
    if (p === "/api/student/programs") return json(200, { programs: o.persona === "hs"
      ? [{ kind: "high_school", id: "e1", title: "High School Diploma (21 credits)", status: "active", current: true }]
      : [{ kind: "degree", id: "e2", title: "BS Business Administration", status: "active", current: true }] });
    if (p === "/api/student/high-school") return o.persona === "hs" ? json(200, hs) : json(404, { error: { code: "HS_NOT_FOUND", message: "none" } });
    if (p === "/api/student/roadmap") return json(200, RICH_MID_JOURNEY);
    if (p === "/api/student/degree-progress") return json(200, COMPOSED);
    if (p === "/api/student/journey") return json(200, journey);
    if (p === "/api/student/calendar") return json(200, { from: url.searchParams.get("from"), to: url.searchParams.get("to"), generatedAt: NOW.toISOString(), truncated: false, items: CAL });
    if (p === "/api/students/me") return json(200, { id: "s1", student_code: "SYN-001", first_name: o.persona === "hs" ? "Noa" : "Avery", last_name: "Synthétique", email: user.email, photo_url: null });
    if (p === "/api/students/me/profile") return json(200, RICH_PROFILE);
    if (p.startsWith("/api/documents/student/")) return json(200, S27_DOCS);
    if (p === "/api/tickets" && r.method() === "GET") return json(200, { tickets: [{ id: "t1", ticket_number: "SUP-0001", subject: "Question about my plan", status: "in_progress", priority: "medium", category: "academic", topic: "roadmap_question", created_at: "2026-10-25T10:00:00Z", updated_at: "2026-10-27T10:00:00Z", last_public_reply_by: "staff", last_public_reply_at: "2026-10-27T10:00:00Z", comment_count: 2, attachment_count: 0 }], pagination: { total: 1, limit: 100, offset: 0 } });
    if (p === "/api/tickets" && r.method() === "POST") return json(201, { ticket: { id: "t2", ticket_number: "SUP-0002" } });
    if (p === "/api/student/billing") return json(200, BILLING_CONFIGURED);
    if (p === "/api/assistant/status") return json(200, { enabled: true, liveModel: false, mode: "local", suggestions: [{ id: "roadmap-how", en: "How does my roadmap work?", fr: "Comment fonctionne ma feuille de route ?" }] });
    if (p === "/api/assistant/conversations") return r.method() === "GET" ? json(200, { conversations: [] }) : json(201, { conversation: { id: "conv-new-0001", title: "", createdAt: NOW.toISOString(), lastActivityAt: NOW.toISOString(), archived: false, messageCount: 0, lastMessagePreview: null } });
    if (p === "/api/student/attachments/policy") return json(200, { enabled: false });
    if (p === "/api/student/welcome") return process.env.S32_WELCOME ? json(200, JSON.parse(process.env.S32_WELCOME)) : json(404, { error: "none" });
    if (p === "/api/student/s29/notifications/preferences") return json(200, { email: { support: true, documents: true, roadmap: true, progress: true, billing: true, appointments: true, operations: true }, quietHours: { enabled: true, start: "21:00", end: "08:00" }, timeZone: null, maxRemindersPerDay: 1 });
    if (p === "/api/student/s29/notifications") return json(200, { unread: 2, items: [
      { id: "n1", category: "appointments", template: "calendar.deadline_soon", language: "fr", title: "Test de langue dans 3 jours", body: "L’échéance de votre test de langue est le 12 novembre.", href: "/calendar", createdAt: "2026-10-29T10:00:00Z", readAt: null },
      { id: "n2", category: "documents", template: "document.rejected", language: "fr", title: "Document à revoir", body: "Votre preuve de scolarité antérieure n’a pas pu être acceptée.", href: "/documents", createdAt: "2026-10-28T10:00:00Z", readAt: null },
      { id: "n3", category: "support", template: "support.reply", language: "fr", title: "Nouvelle réponse à SUP-0001", body: "Lumière a répondu à votre demande.", href: "/support", createdAt: "2026-10-27T10:00:00Z", readAt: "2026-10-27T11:00:00Z" } ] });
    if (p === "/api/student/preferences") return json(200, { language: o.lang });
    if (p === "/api/search") return json(200, { results: [] });
    if (!unstubbed.has(o.screen)) unstubbed.set(o.screen, new Set());
    unstubbed.get(o.screen)!.add(`${r.method()} ${p}`);
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(`pageerror: ${e.message}`));
  await page.goto(BASE + SCREENS[o.screen]!.path);
  await page.waitForSelector("main", { timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(2500);
  return { page, ctx, errors };
}

async function probe(page: any) {
  return page.evaluate(() => {
    const m = document.querySelector("main") as HTMLElement;
    const vw = document.documentElement.clientWidth;
    const overflowX = document.documentElement.scrollWidth - vw;
    const offenders = [...document.querySelectorAll("main *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1; }).slice(0, 4).map((e) => `${e.tagName}.${String((e as HTMLElement).className).slice(0, 40)}`);
    const small: string[] = [];
    for (const el of document.querySelectorAll("a,button,input,select,textarea,[role=button],[role=tab]")) {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden") continue;
      if (r.height < 24 || r.width < 24) small.push(`${((el as HTMLElement).innerText || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 30)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const clipped = [...document.querySelectorAll("main *")].filter((e) => { const h = e as HTMLElement; const cs = getComputedStyle(h); return h.children.length === 0 && h.innerText && h.scrollWidth > h.clientWidth + 2 && (cs.overflow === "hidden" || cs.textOverflow === "ellipsis") ; }).slice(0, 8).map((e) => (e as HTMLElement).innerText.slice(0, 40));
    const iconNoName = [...document.querySelectorAll("button,a")].filter((b) => !(b as HTMLElement).innerText.trim() && !b.getAttribute("aria-label") && !b.getAttribute("title") && !b.getAttribute("aria-labelledby")).length;
    const h1 = [...document.querySelectorAll("h1")].map((h) => (h as HTMLElement).innerText.trim().slice(0, 50));
    const navLinks = [...document.querySelectorAll("nav a, [data-sidebar] a")].map((a) => (a as HTMLElement).innerText.trim()).filter(Boolean);
    const scrollH = m ? m.scrollHeight : 0;
    const text = (m?.innerText ?? "");
    return { overflowX, offenders, small: small.slice(0, 12), smallCount: small.length, clipped, iconNoName, h1, navLinks: [...new Set(navLinks)], scrollScreens: m ? +(scrollH / m.clientHeight).toFixed(1) : 0, text };
  });
}

// crude English-leak detector for FR renders
const EN_WORDS = /\b(the|your|and|with|due|credits?|Overdue|Submitted|Upload|Download|Pending|Approved|Rejected|Request|Open|Next|View|Back|Close|Unit|Exam|Quiz|Task|Course)\b/g;
function enLeaks(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 2);
  return lines.filter((l) => (l.match(EN_WORDS) || []).length >= 2 && !/[éèàùçêâôîû]/i.test(l)).slice(0, 15);
}

async function fullShot(page: any, file: string) {
  const h = await page.evaluate(() => { const m = document.querySelector("main"); return m ? m.scrollHeight + 140 : document.documentElement.scrollHeight; });
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 7000) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: file });
  await page.setViewportSize(vp);
}

async function matrix(browser: any) {
  const sizes: [number, number][] = MODE === "matrix" ? [[1440, 900], [768, 1024], [390, 844]] : [[1440, 900]];
  const report: any[] = [];
  const only = process.env.S32_SCREENS?.split(",");
  for (const [screen, def] of Object.entries(SCREENS)) if (!only || only.includes(screen)) for (const persona of def.personas) for (const [width, height] of sizes) for (const lang of ["fr", "en"] as const) for (const theme of ["lumiere", "lumiere-dark"] as const) {
    if (MODE === "matrix" && theme === "lumiere-dark" && lang === "en") continue; // dark checked in FR; EN light
    const { page, ctx, errors } = await newPage(browser, { width, height, theme, lang, persona, screen });
    const pr = await probe(page);
    const name = `${persona}-${screen}-${lang}-${width}-${theme === "lumiere" ? "light" : "dark"}.png`;
    // first-viewport shot (what the student sees first) + full-page shot
    await page.screenshot({ path: path.join(OUT, "first-" + name) });
    await fullShot(page, path.join(OUT, name));
    const leaks = lang === "fr" ? enLeaks(pr.text) : [];
    report.push({ name, persona, screen, width, lang, theme, overflowX: pr.overflowX, offenders: pr.offenders, smallCount: pr.smallCount, small: pr.small, clipped: pr.clipped, iconNoName: pr.iconNoName, h1: pr.h1, nav: pr.navLinks, scrollScreens: pr.scrollScreens, enLeaks: leaks, errors });
    if (width === 1440 && theme === "lumiere") fs.writeFileSync(path.join(OUT, `text-${persona}-${screen}-${lang}.txt`), pr.text);
    console.log(name, `ovX=${pr.overflowX} small=${pr.smallCount} clip=${pr.clipped.length} noName=${pr.iconNoName} screens=${pr.scrollScreens} enLeaks=${leaks.length} err=${errors.length}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "matrix.json"), JSON.stringify(report, null, 1));
  fs.writeFileSync(path.join(OUT, "unstubbed.json"), JSON.stringify(Object.fromEntries([...unstubbed].map(([k, v]) => [k, [...v]])), null, 1));
}

// S34: programs lookup answers 429 -> the high-school student sees the localized retry state (never the university deck),
// stays signed in, and "Try again" recovers once the limit clears.
async function s34Check(browser: any) {
  const results: unknown[] = [];
  for (const lang of ["fr", "en"] as const) {
    process.env.S34_PROGRAMS_429 = "1";
    const { page, ctx, errors } = await newPage(browser, { width: 390, height: 844, theme: "lumiere", lang, persona: "hs", screen: "flight-deck" });
    const t0 = Date.now();
    await page.waitForSelector('[data-testid="programs-load-error"]', { timeout: 20000 });
    const shownAfterMs = Date.now() - t0;
    const errorText = await page.locator('[data-testid="programs-load-error"]').innerText();
    const mainText = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
    const signedIn = await page.evaluate(() => Boolean(localStorage.getItem("lumiere_auth")));
    const path0 = new URL(page.url()).pathname;
    await page.screenshot({ path: path.join(OUT, `s34-programs-429-${lang}-390.png`) });
    delete process.env.S34_PROGRAMS_429;
    await page.click('[data-testid="programs-retry"]');
    await page.waitForSelector('[data-testid="programs-load-error"]', { state: "detached", timeout: 20000 });
    await page.waitForTimeout(1500);
    const recovered = await page.evaluate(() => document.querySelector("main")?.innerText ?? "");
    await page.screenshot({ path: path.join(OUT, `s34-programs-recovered-${lang}-390.png`) });
    results.push({ lang, shownAfterMs, errorText, path: path0, signedIn, universityDeckShown: /bachelor|baccalaur[ée]at en|BS Business/i.test(mainText),
      recoveredHasHsDeck: /Semaine|Week/.test(recovered), recoveredSnippet: recovered.slice(0, 120), errors });
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "s34-check.json"), JSON.stringify(results, null, 1));
  console.log(JSON.stringify(results, null, 1));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    if (MODE === "journeys") { const j = await import(path.join(path.dirname(new URL(import.meta.url).pathname), process.env.S31_J ?? "s31-journeys.ts")); await j.run(browser, newPage, OUT, posts); }
    else if (MODE === "s34") await s34Check(browser);
    else await matrix(browser);
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { /* gone */ }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
