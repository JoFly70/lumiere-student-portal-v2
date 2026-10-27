/**
 * S21 student OS screenshots + real-browser behaviour checks.   npx tsx scripts/s21/render-screens.ts
 * LOCAL UI SIMULATION: vite dev server + Playwright route interception. Auth and every /api call are stubbed from
 * SYNTHETIC fixtures (fictional people @synthetic.example); external hosts are blocked. Not a deployment; no AI model is
 * called and no backend is involved: the conversation, attachment, search and welcome endpoints are stubs written against
 * docs/recovery/s21/api-contracts.md.
 * Writes ONLY docs/recovery/s21-evidence/screens/*.png and render-notes.json. Login is shot last (it needs the final branding).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { S19_BILLING, S19_DOCS, S19_PARTIAL, S19_TICKETS } from "../../tests/helpers/s19-cockpit-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s21-evidence/screens");
const PORT = Number(process.env.S21_PORT ?? 5241);
const BASE = `http://localhost:${PORT}`;
const PHOTO_HOST = "https://photos.synthetic.example";
const PROGRAMS = { programs: [{ kind: "high_school", id: "e1", title: "High School Diploma (21 credits)", status: "active", current: true }] };
const MB = 1024 * 1024;

/** A 96x96 gradient PNG: a synthetic stand-in for a student photo. */
function syntheticPng(): Buffer {
  const w = 96, h = 96;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 70 + Math.round((x / w) * 120); raw[o + 1] = 90 + Math.round((y / h) * 90); raw[o + 2] = 140;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

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

/* ------------------------------------------------------------------------------------------- fixtures */
const SUGGESTIONS = [
  { id: "roadmap-how", en: "How does my roadmap work?", fr: "Comment fonctionne ma feuille de route ?" },
  { id: "documents-what", en: "Which documents should I upload?", fr: "Quels documents dois-je téléverser ?" },
];
const POLICY = {
  types: [
    { ext: "pdf", mime: "application/pdf", maxBytes: 25 * MB }, { ext: "png", mime: "image/png", maxBytes: 10 * MB },
    { ext: "jpg", mime: "image/jpeg", maxBytes: 10 * MB }, { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", maxBytes: 25 * MB },
  ],
  maxPerMessage: 5, maxBytesPerMessage: 50 * MB, quotaBytes: 250 * MB, usedBytes: 38 * MB,
};
const DOCS = [
  { id: "doc-1", fileName: "Official transcript - Westbrook SS.pdf", mimeType: "application/pdf", sizeBytes: 1.8 * MB, docType: "transcript", source: "documents", status: "verified", uploadedAt: "2026-09-12T10:00:00Z", extractionStatus: "indexed" },
  { id: "doc-2", fileName: "Passport photo page.png", mimeType: "image/png", sizeBytes: 0.9 * MB, docType: "passport", source: "documents", status: "uploaded", uploadedAt: "2026-09-12T10:05:00Z", extractionStatus: "stored_only" },
  { id: "doc-3", fileName: "Study plan notes.docx", mimeType: "x", sizeBytes: 64 * 1024, docType: "chat_attachment", source: "chat", status: "uploaded", uploadedAt: "2026-10-02T10:05:00Z", extractionStatus: "indexed" },
];
interface Conv { id: string; title: string; createdAt: string; lastActivityAt: string; archived: boolean; messageCount: number; lastMessagePreview: string | null }
const iso = (d: number) => new Date(Date.UTC(2026, 9, 27, 12) - d * 86_400_000).toISOString();
const msg = (id: string, seq: number, role: string, content: string, extra: Record<string, unknown> = {}) => ({
  id, seq, role, content, language: "en", mode: role === "assistant" ? "local" : null, sources: [], links: [], privateRefs: [], notice: null, attachments: [], createdAt: iso(1), ...extra,
});
function seedState() {
  const convs: Conv[] = [
    { id: "conv-roadmap-0001", title: "Transfer credit rules", createdAt: iso(2), lastActivityAt: iso(0.1), archived: false, messageCount: 4, lastMessagePreview: "A credit becomes official once your awarding school confirms it." },
    { id: "conv-docs-000002", title: "Which documents do I need?", createdAt: iso(5), lastActivityAt: iso(4), archived: false, messageCount: 2, lastMessagePreview: "Start with your official transcript and a passport photo page." },
    { id: "conv-plan-000003", title: "Planning my first term", createdAt: iso(12), lastActivityAt: iso(9), archived: false, messageCount: 6, lastMessagePreview: "Most students begin with three or four courses." },
    { id: "conv-old-0000004", title: "Passport name question", createdAt: iso(40), lastActivityAt: iso(30), archived: true, messageCount: 2, lastMessagePreview: "Your legal name must match your passport." },
  ];
  const messages: Record<string, ReturnType<typeof msg>[]> = {
    "conv-roadmap-0001": [
      msg("m1", 1, "student", "Does my transcript count towards my first-term credits?", { attachments: [{ documentId: "doc-1", fileName: "Official transcript - Westbrook SS.pdf", mimeType: "application/pdf", sizeBytes: 1.8 * MB }] }),
      msg("m2", 2, "assistant", "Your transcript is on file and was verified in September. A credit becomes official once your awarding school confirms it, so it shows as planned until then.", {
        privateRefs: [{ kind: "document", title: "Official transcript - Westbrook SS.pdf", path: "/documents" }, { kind: "academic", title: "Your credit summary", path: "/flight-deck" }],
        links: [{ label: "My roadmap", path: "/roadmap" }],
        sources: [{ title: "Lumière transfer credit guide", url: "https://example.org/lumiere-transfer-guide", verifiedAt: "2026-10-20" }],
      }),
      msg("m3", 3, "student", "Can I move a course to next term?"),
      msg("m4", 4, "assistant", "I could not find a Lumière source for moving a course between terms, so I would rather not guess. Your coach can confirm what is possible for your program."),
    ],
    "conv-docs-000002": [msg("m5", 1, "student", "Which documents do I need?"), msg("m6", 2, "assistant", "Start with your official transcript and a passport photo page.", { links: [{ label: "Documents", path: "/documents" }] })],
    "conv-plan-000003": [msg("m7", 1, "student", "How many courses should I plan?"), msg("m8", 2, "assistant", "Most students begin with three or four courses.")],
    "conv-old-0000004": [msg("m9", 1, "student", "Does my passport name matter?"), msg("m10", 2, "assistant", "Your legal name must match your passport.")],
  };
  return { convs, messages };
}

const bodies: { url: string; method: string; body: any }[] = [];
const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => { checks.push({ name, ok, detail }); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };

interface Opts {
  width: number; height: number; theme: string; lang?: "en" | "fr"; role?: "student" | "admin"; photo?: boolean;
  welcome?: "first" | "returning" | "none"; failFirstSend?: boolean; reduced?: boolean; path?: string;
}

async function newPage(browser: any, o: Opts) {
  const state = seedState();
  let sendAttempts = 0;
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: o.reduced ? "reduce" : "no-preference", hasTouch: o.width < 500 });
  const role = o.role ?? "student";
  const user = role === "admin"
    ? { id: "staff-user-1", email: "tomas.reyes@synthetic.example", name: "Tomas Reyes", role: "admin" }
    : { id: "student-user-1", email: "amelie.laurent@synthetic.example", name: "Amélie Laurent", role: "student" };
  await ctx.addInitScript(([theme, u, lang]: [string, unknown, string]) => {
    localStorage.setItem("lumiere-portal:theme", theme);
    localStorage.setItem("lumiere_language", lang);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
  }, [o.theme, user, o.lang ?? "en"] as [string, unknown, string]);
  await ctx.addInitScript("window.__name = (f) => f;");
  const png = syntheticPng();
  await ctx.route(/.*/, async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.origin === PHOTO_HOST) return route.fulfill({ status: 200, contentType: "image/png", body: png });
    if (url.hostname !== "localhost") return route.abort();
    const p = url.pathname;
    if (p.startsWith("/__upload/")) return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    if (!p.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const body = r.method() === "GET" ? undefined : JSON.parse(r.postData() || "{}");
    if (r.method() !== "GET") bodies.push({ url: p, method: r.method(), body });

    if (p === "/api/assistant/status") return json(200, { enabled: true, liveModel: false, mode: "local", suggestions: SUGGESTIONS });
    if (p === "/api/assistant/conversations" && r.method() === "GET") {
      const archived = url.searchParams.get("archived") === "true";
      return json(200, { conversations: state.convs.filter((c) => c.archived === archived).sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)) });
    }
    if (p === "/api/assistant/conversations" && r.method() === "POST") {
      const c: Conv = { id: `conv-new-${state.convs.length + 1}000`, title: body.title ?? "", createdAt: iso(0), lastActivityAt: iso(0), archived: false, messageCount: 0, lastMessagePreview: null };
      state.convs.push(c); state.messages[c.id] = [];
      return json(201, { conversation: c });
    }
    if (p === "/api/assistant/conversations/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const hits = Object.entries(state.messages).flatMap(([cid, ms]) => ms.filter((m) => m.content.toLowerCase().includes(q)).map((m) => ({
        conversationId: cid, conversationTitle: state.convs.find((c) => c.id === cid)?.title ?? "", messageId: m.id, role: m.role, snippet: m.content.slice(0, 120), createdAt: m.createdAt,
      })));
      return json(200, { hits });
    }
    const conv = p.match(/^\/api\/assistant\/conversations\/([^/]+)(?:\/(archive|unarchive|messages))?$/);
    if (conv) {
      const c = state.convs.find((x) => x.id === conv[1]);
      if (!c) return json(404, { error: "Not found", code: "not_found" });
      if (conv[2] === "archive" || conv[2] === "unarchive") { c.archived = conv[2] === "archive"; return json(200, { conversation: c }); }
      if (conv[2] === "messages") {
        sendAttempts += 1;
        if (o.failFirstSend && sendAttempts === 1) return json(500, { error: "boom", code: "internal" });
        if (c.archived) return json(409, { error: "archived", code: "archived" });
        await new Promise((res) => setTimeout(res, 150));
        const ms = state.messages[c.id] ?? (state.messages[c.id] = []);
        const attach = (body.attachmentDocumentIds ?? []).map((id: string) => {
          const d = DOCS.find((x) => x.id === id) ?? { id, fileName: "uploaded.pdf", mimeType: "application/pdf", sizeBytes: 2 * MB };
          return { documentId: d.id, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes };
        });
        const sm = msg(`n${ms.length + 1}`, ms.length + 1, "student", body.message, { attachments: attach, language: body.language });
        const am = msg(`n${ms.length + 2}`, ms.length + 2, "assistant", body.language === "fr"
          ? "Votre feuille de route liste les cours que vous prévoyez de suivre. Un crédit ne devient officiel qu’une fois confirmé par votre établissement."
          : "Your roadmap lists the courses you plan to take. A credit only becomes official once your awarding school confirms it.", {
          language: body.language,
          sources: [{ title: body.language === "fr" ? "Guide Lumière de la feuille de route" : "Lumière roadmap guide", url: "https://example.org/lumiere-roadmap-guide", verifiedAt: "2026-10-27" }],
          links: [{ label: body.language === "fr" ? "Ma feuille de route" : "My roadmap", path: "/roadmap" }],
        });
        ms.push(sm, am); c.messageCount = ms.length; c.lastMessagePreview = body.message; c.lastActivityAt = iso(0);
        return json(200, { studentMessage: sm, assistantMessage: am, replayed: false });
      }
      if (r.method() === "PATCH") { c.title = body.title; return json(200, { conversation: c }); }
      return json(200, { conversation: c, messages: state.messages[c.id] ?? [] });
    }
    if (p === "/api/student/attachments/policy") return json(200, POLICY);
    if (p === "/api/student/attachments/documents") return json(200, { documents: DOCS });
    if (p === "/api/student/attachments/upload-url") return json(200, { uploadUrl: `${BASE}/__upload/${encodeURIComponent(body.fileName)}`, uploadToken: "t", storagePath: `chat/${body.fileName}`, expiresIn: 600 });
    if (p === "/api/student/attachments/finalize") return json(201, { document: { id: `doc-up-${bodies.length}`, fileName: body.fileName, mimeType: "application/pdf", sizeBytes: 2.2 * MB, docType: "chat_attachment", source: "chat", status: "uploaded", uploadedAt: iso(0), extractionStatus: "pending" } });
    if (p.startsWith("/api/documents/doc-")) return json(200, { id: p.split("/").pop(), download_url: `${BASE}/__upload/preview.pdf`, download_expires_in: 60 });
    if (p === "/api/search") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const all = [
        { type: "course", id: "c1", title: "Calculus I (MATH 101)", subtitle: "Planned · Fall term", path: "/roadmap", score: 7 },
        { type: "document", id: "doc-1", title: "Official transcript - Westbrook SS.pdf", subtitle: "Transcript · verified", path: "/documents", score: 9 },
        { type: "document", id: "doc-3", title: "Study plan notes.docx", subtitle: "Chat upload", path: "/documents", score: 4 },
        { type: "ticket", id: "t1", title: "Question about transfer credit", subtitle: "Waiting on you", path: "/support", score: 6 },
        { type: "conversation", id: "conv-roadmap-0001", title: "Transfer credit rules", subtitle: "Guide conversation", path: "/assistant?conversation=conv-roadmap-0001", score: 5 },
        { type: "student", id: "s9", title: "Amélie Laurent", subtitle: "SYN-001 · amelie.laurent@synthetic.example", path: "/admin/students/s9", score: 10 },
        { type: "student", id: "s10", title: "Amir Laurent-Diaz", subtitle: "SYN-002", path: "/admin/students/s10", score: 6 },
      ].filter((x) => role === "admin" ? x.type === "student" : x.type !== "student");
      return json(200, { results: all.filter((x) => (x.title + " " + (x.subtitle ?? "")).toLowerCase().includes(q.replace(/^trans$/, "tran")) || (q === "lau" && x.type === "student")) });
    }
    if (p === "/api/students/me") return json(200, { id: "s1", student_code: "SYN-001", first_name: "Amélie", last_name: "Laurent", email: user.email, photo_url: o.photo ? `${PHOTO_HOST}/amelie.png` : null });
    if (p === "/api/student/welcome") return o.welcome === "none" ? json(404, { error: "none" }) : json(200, { firstName: "Amélie", kind: o.welcome ?? "returning", attention: o.welcome === "first" ? { count: 0, path: null } : { count: 2, path: "/documents" }, photo: !!o.photo });
    if (p === "/api/student/programs") return json(200, PROGRAMS);
    if (p === "/api/student/academic-projection") return json(200, S19_PARTIAL);
    if (p.startsWith("/api/documents/student/")) return json(200, S19_DOCS);
    if (p === "/api/tickets") return json(200, S19_TICKETS);
    if (p === "/api/student/billing") return json(200, S19_BILLING);
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  page.on("console", (m: any) => { if (m.type() === "error" && !/Failed to load resource|404|STUB/.test(m.text())) console.error("console.error:", m.text().slice(0, 200)); });
  await page.goto(BASE + (o.path ?? "/flight-deck"));
  await page.waitForSelector('[data-testid="student-header"], [data-testid="staff-header"]', { timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(1100);
  return { page, ctx, state };
}

const shot = async (page: any, name: string, opts: { clip?: { x: number; y: number; width: number; height: number } } = {}) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(OUT, name), ...opts });
  console.log("wrote", name);
};
const noOverflow = (page: any) => page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth);
const inViewport = (page: any, sel: string) => page.evaluate((s: string) => { const e = document.querySelector(s) as HTMLElement | null; if (!e) return false; const r = e.getBoundingClientRect(); return r.left >= -0.5 && r.right <= innerWidth + 0.5; }, sel);
const openAssistant = async (page: any) => { await page.click('[data-testid="assistant-fab"]'); await page.waitForSelector('[data-testid="assistant-panel"]'); };

/* ------------------------------------------------------------------------------------------- scenarios */
async function cockpitAndHeader(browser: any) {
  // Desktop cockpit with a photo avatar and the returning welcome.
  let { page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", photo: true, welcome: "returning" });
  await page.waitForSelector('[data-testid="welcome-banner"]', { timeout: 8000 }).catch(() => undefined);
  const hasWelcome = (await page.locator('[data-testid="welcome-banner"]').count()) > 0;
  check("cockpit: welcome banner present (Sonnet D component)", hasWelcome);
  await page.waitForFunction(() => { const i = document.querySelector('[data-testid="header-avatar"] img') as HTMLImageElement | null; return !i || i.complete; }, null, { timeout: 5000 }).catch(() => undefined);
  await shot(page, "cockpit-desktop-avatar.png");
  check("header avatar shows the photo", (await page.locator('[data-testid="header-avatar"] img').count()) === 1);
  await page.click('[data-testid="button-account-menu"]');
  await page.waitForSelector('[data-testid="account-menu"]');
  await shot(page, "account-menu-desktop.png", { clip: { x: 840, y: 0, width: 600, height: 380 } });
  const items = await page.locator('[data-testid="account-menu"] a, [data-testid="account-menu"] button').allTextContents();
  check("account menu: My Profile, Change Photo, Sign Out", ["My Profile", "Change Photo", "Sign Out"].every((t) => items.some((x: string) => x.includes(t))), items.join("|"));
  await page.click('[data-testid="account-menu-photo"]');
  await page.waitForSelector('[data-testid="photo-dialog"]');
  check("Change Photo opens the existing upload flow", (await page.locator('[data-testid="input-photo-upload"]').count()) === 1);
  await shot(page, "account-change-photo-dialog.png");
  await page.keyboard.press("Escape");
  await ctx.close();

  // First-login welcome (initials avatar).
  ({ page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", welcome: "first" }));
  await page.waitForSelector('[data-testid="welcome-banner"]', { timeout: 8000 }).catch(() => undefined);
  await shot(page, "welcome-first-login.png", { clip: { x: 0, y: 0, width: 1440, height: 420 } });
  check("first-login welcome renders", (await page.locator('[data-testid="welcome-banner"][data-kind="first"]').count()) === 1);
  check("header avatar falls back to initials", (await page.textContent('[data-testid="header-avatar-initials"]'))?.trim() === "AL");
  await ctx.close();
  ({ page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", welcome: "returning" }));
  await page.waitForSelector('[data-testid="welcome-banner"]', { timeout: 8000 }).catch(() => undefined);
  await shot(page, "welcome-returning.png", { clip: { x: 0, y: 0, width: 1440, height: 420 } });
  await ctx.close();

  // Mobile header: not crowded at 390 and 360.
  for (const w of [390, 360]) {
    ({ page, ctx } = await newPage(browser, { width: w, height: 800, theme: "lumiere", welcome: "returning" }));
    if (w === 390) await shot(page, "mobile-header-avatar-390.png", { clip: { x: 0, y: 0, width: 390, height: 520 } });
    else await shot(page, "mobile-header-avatar-360.png", { clip: { x: 0, y: 0, width: 360, height: 520 } });
    check(`mobile ${w}: no horizontal page scroll`, await noOverflow(page));
    const hdr = await page.evaluate(() => { const h = document.querySelector('[data-testid="student-header"]') as HTMLElement; return { sw: h.scrollWidth, cw: h.clientWidth }; });
    check(`mobile ${w}: header content fits`, hdr.sw <= hdr.cw, JSON.stringify(hdr));
    check(`mobile ${w}: avatar + search + bottom nav visible`, (await page.locator('[data-testid="button-account-menu"]').isVisible()) && (await page.locator('[data-testid="global-search-open"]').isVisible()) && (await page.locator('[data-testid="student-bottom-nav"]').isVisible()));
    if (w === 390) {
      await page.click('[data-testid="button-account-menu"]');
      await page.waitForSelector('[data-testid="account-menu-prefs"]');
      check("mobile: language + theme live in the account menu", (await page.locator('[data-testid="account-menu-prefs"] [data-testid="language-toggle"]').isVisible()));
      await shot(page, "account-menu-mobile-390.png");
    }
    await ctx.close();
  }
}

async function searchScenes(browser: any) {
  let { page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", welcome: "none" });
  await page.keyboard.press("Control+k");
  check("Ctrl+K focuses the header search", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "global-search-input");
  await page.keyboard.type("trans");
  await page.waitForSelector('[data-testid="global-search-list"]');
  await shot(page, "global-search-results.png", { clip: { x: 0, y: 0, width: 1440, height: 520 } });
  const groups = await page.locator('[data-testid^="global-search-group-"]').allTextContents();
  check("results are grouped by type with labels", groups.length >= 3, groups.join("|"));
  await page.keyboard.press("ArrowDown");
  const active = await page.getAttribute('[data-testid="global-search-input"]', "aria-activedescendant");
  check("ArrowDown moves the active descendant", !!active, active ?? "");
  await page.keyboard.press("Escape");
  check("Esc clears the query", (await page.inputValue('[data-testid="global-search-input"]')) === "");
  await page.keyboard.type("trans");
  await page.waitForSelector('[data-testid="global-search-list"]');
  await page.mouse.click(420, 125);
  await page.waitForSelector('[data-testid="global-search-dropdown"]', { state: "detached" });
  check("outside click closes the results", true);
  await page.focus('[data-testid="global-search-input"]');
  await page.fill('[data-testid="global-search-input"]', "bill");
  await page.waitForSelector('[data-testid="global-search-option-page"]');
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname === "/billing", null, { timeout: 5000 });
  check("Enter on a page result navigates to /billing", true);
  // A conversation result opens the assistant on that conversation.
  await page.fill('[data-testid="global-search-input"]', "transfer credit");
  await page.waitForSelector('[data-testid="global-search-option-conversation"]');
  await page.click('[data-testid="global-search-option-conversation"]');
  await page.waitForSelector('[data-testid="assistant-panel"]');
  await page.waitForSelector('[data-testid="assistant-answer"]');
  check("conversation result opens that conversation in the assistant", (await page.textContent('[data-testid="assistant-subtitle"]'))?.includes("Transfer credit rules") ?? false);
  await ctx.close();

  ({ page, ctx } = await newPage(browser, { width: 390, height: 844, theme: "lumiere", welcome: "none" }));
  await page.click('[data-testid="global-search-open"]');
  await page.waitForSelector('[data-testid="global-search-overlay"]');
  await page.keyboard.type("trans");
  await page.waitForSelector('[data-testid="global-search-list"]');
  await shot(page, "global-search-mobile-390.png");
  check("mobile overlay: no horizontal overflow", await noOverflow(page));
  await page.keyboard.press("Escape");
  await page.waitForSelector('[data-testid="global-search-overlay"]', { state: "detached" });
  check("mobile overlay closes with Esc and returns focus", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "global-search-open");
  await ctx.close();

  // Staff: students only.
  ({ page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", role: "admin", path: "/support" }));
  await page.fill('[data-testid="global-search-input"]', "lau");
  await page.waitForSelector('[data-testid="global-search-list"]');
  const types = await page.locator('[data-testid^="global-search-option-"]').evaluateAll((els: Element[]) => els.map((e) => e.getAttribute("data-testid")));
  check("staff search lists students only", types.length > 0 && types.every((t) => t === "global-search-option-student"), types.join(","));
  await shot(page, "global-search-staff.png", { clip: { x: 0, y: 0, width: 1440, height: 480 } });
  await ctx.close();
}

async function assistantScenes(browser: any) {
  let { page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", welcome: "none" });
  await openAssistant(page);
  await page.waitForSelector('[data-testid="assistant-answer"]');
  check("opening the drawer resumes the latest conversation", (await page.textContent('[data-testid="assistant-subtitle"]'))?.includes("Transfer credit rules") ?? false);
  await shot(page, "assistant-opened-historical-conversation.png");
  check("answer shows 'From your records' and sources", (await page.locator('[data-testid="assistant-private-refs"]').count()) === 1 && (await page.locator('[data-testid="assistant-sources"]').count()) === 1);
  check("sourceless answer offers Support", (await page.locator('[data-testid="assistant-escalate-link"]').count()) === 1);
  const label = await page.locator('[data-testid="assistant-mode-label"]').first().textContent();
  check("local answers are not called AI", /Lumière guide/.test(label ?? "") && !/\bAI\b/.test(label ?? ""));
  check("sent attachment chip is present", (await page.locator('[data-testid="assistant-sent-attachment"]').count()) === 1);

  await page.click('[data-testid="assistant-history-btn"]');
  await page.waitForSelector('[data-testid="assistant-conversation-list"]');
  await shot(page, "assistant-history-list.png");
  const titles = await page.locator('[data-testid="assistant-conversation"] .aa-conv-title').allTextContents();
  check("history lists newest first", titles[0] === "Transfer credit rules" && titles.length === 3, titles.join("|"));
  // roving focus
  await page.focus('[data-roving]');
  await page.keyboard.press("ArrowDown");
  check("ArrowDown moves between conversations", (await page.evaluate(() => document.activeElement?.getAttribute("data-roving"))) === "true" && (await page.evaluate(() => document.activeElement?.textContent?.includes("Which documents")) ?? false));
  // search
  await page.fill('[data-testid="assistant-history-search"]', "passport");
  await page.waitForSelector('[data-testid="assistant-search-hits"]');
  await shot(page, "assistant-history-search.png");
  check("search finds archived conversations too", (await page.locator('[data-testid="assistant-search-hit"]').count()) >= 1);
  await page.fill('[data-testid="assistant-history-search"]', "");
  // rename
  await page.click('[data-testid="assistant-conversation-rename"] >> nth=1');
  await page.fill('[data-testid="assistant-rename-input"]', "Documents checklist");
  await page.click('[data-testid="assistant-rename-save"]');
  await page.waitForFunction(() => document.body.textContent?.includes("Documents checklist"));
  check("rename sends PATCH {title}", bodies.some((b) => b.method === "PATCH" && b.body.title === "Documents checklist"));
  // archive, then archived filter, then unarchive
  await page.click('[data-testid="assistant-conversation-archive"] >> nth=2');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-conversation"]').length === 2);
  await page.click('[data-testid="assistant-filter-archived"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-conversation"]').length === 2);
  await shot(page, "assistant-history-archived.png");
  check("archived filter shows archived conversations", (await page.locator('[data-testid="assistant-conversation"].is-archived').count()) === 2);
  await page.click('[data-testid="assistant-conversation-archive"] >> nth=0');
  await page.click('[data-testid="assistant-filter-active"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-conversation"]').length === 3);
  check("unarchive restores to the current list", true);
  // Esc goes back to the chat before closing
  await page.keyboard.press("Escape");
  check("Esc leaves history but keeps the drawer open", (await page.getAttribute('[data-testid="assistant-panel"]', "data-panel")) === "chat");

  // attachments: policy pre-validation (no network for a rejected file)
  const before = bodies.length;
  await page.setInputFiles('[data-testid="assistant-file-input"]', { name: "virus.exe", mimeType: "application/x-msdownload", buffer: Buffer.from("MZ") });
  await page.waitForSelector('[data-testid="assistant-attach-problem"]');
  check("a disallowed type is rejected in the browser, without any upload request", bodies.length === before && /not accepted/.test((await page.textContent('[data-testid="assistant-attach-problem"]')) ?? ""));
  await page.setInputFiles('[data-testid="assistant-file-input"]', { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(11 * MB) });
  check("an oversize file is rejected in the browser", /larger than/.test((await page.textContent('[data-testid="assistant-attach-problem"]')) ?? "") && bodies.length === before);
  await page.setInputFiles('[data-testid="assistant-file-input"]', { name: "letter-of-acceptance.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(2 * MB, 1) });
  await page.waitForSelector('[data-testid="assistant-attachment-chip"][data-state="ready"]', { timeout: 8000 });
  const calls = bodies.slice(before).map((b) => b.url);
  check("upload = upload-url then finalize", calls.join(",") === "/api/student/attachments/upload-url,/api/student/attachments/finalize", calls.join(","));
  // picker
  await page.click('[data-testid="assistant-attach"]');
  await page.waitForSelector('[data-testid="assistant-attach-menu"]');
  await shot(page, "assistant-attach-menu.png");
  check("attach menu: Upload a file / Choose from my documents", (await page.locator('[data-testid="assistant-attach-menu"] [role="menuitem"]').count()) === 2);
  await page.click('[data-testid="assistant-attach-choose"]');
  await page.waitForSelector('[data-testid="assistant-picker-item"]');
  await page.locator('[data-testid="assistant-picker-item"]').first().check();
  await shot(page, "assistant-attachment-picker.png");
  await page.click('[data-testid="assistant-picker-add"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-attachment-chip"]').length === 2);
  await shot(page, "assistant-composer-with-chips.png");
  // send with attachments
  await page.fill('[data-testid="assistant-input"]', "Please check these against my roadmap.");
  await page.click('[data-testid="assistant-send"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-answer"]').length === 3, null, { timeout: 8000 });
  const sent = bodies.filter((b) => /\/messages$/.test(b.url)).at(-1)!;
  check("send posts clientRequestId + attachmentDocumentIds (2)", /^[0-9a-f-]{36}$/.test(sent.body.clientRequestId) && sent.body.attachmentDocumentIds.length === 2 && sent.body.language === "en", JSON.stringify(sent.body));
  await page.waitForTimeout(400);
  await shot(page, "assistant-message-with-attachment.png");
  check("sent message shows both attachment chips", (await page.locator('[data-testid="assistant-sent-attachment"]').count()) >= 3);
  // open an attachment through the signed-URL route
  const popup = page.waitForEvent("popup", { timeout: 4000 }).catch(() => null);
  await page.locator('[data-testid="assistant-sent-attachment"]').last().click();
  const opened = await popup;
  check("opening an attachment fetches GET /api/documents/:id then opens its signed URL", !!opened);
  await opened?.close();
  // Tab trap
  let escaped = false;
  for (let i = 0; i < 16; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="assistant-panel"]')))) escaped = true; }
  check("Tab never leaves the dialog", !escaped);
  await ctx.close();

  // Retry keeps the clientRequestId.
  ({ page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", welcome: "none", failFirstSend: true }));
  await openAssistant(page);
  await page.waitForSelector('[data-testid="assistant-answer"]');
  await page.click('[data-testid="assistant-clear"]');
  await page.fill('[data-testid="assistant-input"]', "Retry me please");
  await page.click('[data-testid="assistant-send"]');
  await page.waitForSelector('[data-testid="assistant-error"]');
  await shot(page, "assistant-send-failed.png");
  await page.click('[data-testid="assistant-retry"]');
  await page.waitForSelector('[data-testid="assistant-answer"]');
  const posts = bodies.filter((b) => /\/messages$/.test(b.url) && b.body.message === "Retry me please");
  check("a retry reuses the same clientRequestId", posts.length === 2 && posts[0]!.body.clientRequestId === posts[1]!.body.clientRequestId, posts.map((p) => p.body.clientRequestId).join(" / "));
  const creates = bodies.filter((b) => b.url === "/api/assistant/conversations" && b.method === "POST");
  check("a new conversation was created once for it", creates.length === 1);
  await ctx.close();

  // Mobile, French, dark.
  ({ page, ctx } = await newPage(browser, { width: 390, height: 844, theme: "lumiere", welcome: "none" }));
  await openAssistant(page);
  await page.waitForSelector('[data-testid="assistant-answer"]');
  const panel = await page.evaluate(() => { const r = document.querySelector('[data-testid="assistant-panel"]')!.getBoundingClientRect(); return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; });
  check("mobile: full-height sheet", panel.w === panel.vw && Math.abs(panel.h - panel.vh) < 2, JSON.stringify(panel));
  await shot(page, "assistant-mobile-390.png");
  await page.click('[data-testid="assistant-history-btn"]');
  await page.waitForSelector('[data-testid="assistant-conversation-list"]');
  await shot(page, "assistant-mobile-history-390.png");
  await ctx.close();

  ({ page, ctx } = await newPage(browser, { width: 360, height: 740, theme: "lumiere", welcome: "none" }));
  await openAssistant(page);
  await page.waitForSelector('[data-testid="assistant-answer"]');
  await page.click('[data-testid="assistant-attach"]');
  await page.waitForSelector('[data-testid="assistant-attach-menu"]');
  check("360px: composer and menu inside the viewport, no page scroll", (await inViewport(page, '[data-testid="assistant-attach-menu"]')) && (await inViewport(page, '[data-testid="assistant-send"]')) && (await noOverflow(page)));
  const panelOverflow = await page.evaluate(() => { const p = document.querySelector('[data-testid="assistant-panel"]') as HTMLElement; return p.scrollWidth > p.clientWidth; });
  check("360px: the drawer itself does not scroll sideways", !panelOverflow);
  await shot(page, "assistant-mobile-360-menu.png");
  await ctx.close();

  ({ page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", lang: "fr", welcome: "none" }));
  await openAssistant(page);
  await page.waitForSelector('[data-testid="assistant-answer"]');
  await page.click('[data-testid="assistant-clear"]');
  await shot(page, "assistant-fr-greeting.png");
  await page.click('[data-testid="assistant-suggestion-roadmap-how"]');
  await page.waitForSelector('[data-testid="assistant-answer"]');
  await shot(page, "assistant-fr-conversation.png");
  check("French: greeting and labels", /Guide Lumière/.test((await page.textContent('[data-testid="assistant-panel"]')) ?? ""));
  await ctx.close();

  ({ page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "monaco", welcome: "none" }));
  await page.keyboard.press("Control+k");
  await page.keyboard.type("trans");
  await page.waitForSelector('[data-testid="global-search-list"]');
  await shot(page, "dark-monaco-global-search.png", { clip: { x: 0, y: 0, width: 1440, height: 520 } });
  await page.keyboard.press("Escape");
  await page.mouse.click(420, 125);
  await openAssistant(page);
  await page.waitForSelector('[data-testid="assistant-answer"]');
  await page.click('[data-testid="assistant-history-btn"]');
  await page.waitForSelector('[data-testid="assistant-conversation-list"]');
  await shot(page, "dark-monaco-assistant-history.png");
  await ctx.close();
}

async function loginScene(browser: any) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => localStorage.setItem("lumiere_language", "en"));
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "not signed in" }) });
  });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login");
  await page.waitForSelector('[data-testid="auth-layout"]', { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(3500);
  const text = (await page.textContent("body")) ?? "";
  check("login shows 'Student Portal' branding", /Student Portal/i.test(text));
  await shot(page, "login-student-portal.png");
  await ctx.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    await cockpitAndHeader(browser);
    await searchScenes(browser);
    await assistantScenes(browser);
    await loginScene(browser);
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
  fs.writeFileSync(path.join(OUT, "render-notes.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "LOCAL UI SIMULATION. Synthetic fixtures; stubbed auth and /api (incl. conversations, attachments, search, welcome) written against docs/recovery/s21/api-contracts.md; real student shell rendered by a local vite dev server. Not a deployment; no backend, database, storage or AI model was involved.",
    checks,
  }, null, 2));
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) process.exit(1);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
