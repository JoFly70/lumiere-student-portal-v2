/**
 * S20 assistant screenshots + real-browser behaviour checks.   npx tsx scripts/s20/render-assistant-screens.ts
 * LOCAL UI SIMULATION: vite dev server + Playwright route interception. Auth and every /api call are stubbed from
 * SYNTHETIC fixtures (fictional person @synthetic.example); external hosts are blocked. Not a deployment.
 * Writes ONLY docs/recovery/s20-evidence/screens/assistant-*.png and assistant-render-notes.json.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { ALL_DETAILS, toSummary, CONTEXT_OPTIONS } from "../../tests/helpers/support-ui-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s20-evidence/screens");
const PORT = Number(process.env.S20_PORT ?? 5231);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
const HARNESS = path.join(ROOT, "scripts/s20/assistant-harness-main.tsx");
const SUMMARIES = ALL_DETAILS.map(toSummary);

const SUGGESTIONS = [
  { id: "roadmap-how", en: "How does my roadmap work?", fr: "Comment fonctionne ma feuille de route ?" },
  { id: "official-credits", en: "What makes a credit official?", fr: "Qu’est-ce qui rend un crédit officiel ?" },
  { id: "documents-what", en: "Which documents should I upload?", fr: "Quels documents dois-je téléverser ?" },
];
const ANSWER = {
  en: { reply: "Your roadmap lists the courses you plan to take, in the order that fits your program. A credit only becomes official once your awarding school confirms it.\n\nOpen the roadmap to see what is planned, in progress or confirmed.", label: "My roadmap", title: "Lumière roadmap guide" },
  fr: { reply: "Votre feuille de route liste les cours que vous prévoyez de suivre, dans l’ordre qui convient à votre programme. Un crédit ne devient officiel qu’une fois confirmé par votre établissement.\n\nOuvrez la feuille de route pour voir ce qui est prévu, en cours ou confirmé.", label: "Ma feuille de route", title: "Guide Lumière de la feuille de route" },
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

interface Opts { width: number; height: number; theme: string; lang?: "en" | "fr"; reduced?: boolean }
const bodies: any[] = [];

async function newPage(browser: any, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, reducedMotion: o.reduced ? "reduce" : "no-preference", hasTouch: o.width < 500, isMobile: false });
  const user = { id: "student-user-1", email: "amelie.laurent@synthetic.example", name: "Amélie Laurent", role: "student" };
  await ctx.addInitScript(([theme, u, lang]: [string, unknown, string]) => {
    localStorage.setItem("lumiere-portal:theme", theme);
    localStorage.setItem("lumiere_language", lang);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
  }, [o.theme, user, o.lang ?? "en"] as [string, unknown, string]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.route(/.*/, async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.hostname !== "localhost") return route.abort();
    if (url.pathname === "/src/main.tsx") {
      return route.fulfill({ status: 200, contentType: "text/javascript", body: `import "/@fs${HARNESS}";` });
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === "/api/assistant/status") return json(200, { enabled: true, liveModel: false, mode: "local", reason: "disabled", suggestions: SUGGESTIONS });
    if (p === "/api/assistant/message") {
      const b = JSON.parse(r.postData() || "{}");
      bodies.push(b);
      if (/THROTTLE/.test(b.message)) return json(429, { error: "Too many requests", code: "throttled" });
      if (/DOWN/.test(b.message)) return json(503, { error: "Unavailable", code: "unavailable" });
      await new Promise((res) => setTimeout(res, /SLOW/.test(b.message) ? 1500 : 120));
      const a = ANSWER[b.language as "en" | "fr"] ?? ANSWER.en;
      return json(200, { reply: a.reply, mode: "local", sources: [{ title: a.title, url: "https://example.org/lumiere-roadmap-guide", verifiedAt: "2026-10-27" }], links: [{ label: a.label, path: "/roadmap" }] });
    }
    if (p === "/api/students/me") return json(200, { id: "s1", first_name: "Amélie", last_name: "Laurent", email: user.email, photo_url: null });
    if (p === "/api/tickets/context-options") return json(200, CONTEXT_OPTIONS);
    if (p === "/api/tickets") return json(200, { tickets: SUMMARIES, pagination: { total: SUMMARIES.length, limit: 100, offset: 0 } });
    return json(404, { error: "not stubbed", code: "STUB_NOT_FOUND" });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  await page.goto(BASE + "/support");
  await page.waitForSelector('[data-testid="assistant-fab"]', { timeout: 30_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(900);
  return { page, ctx };
}

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => { checks.push({ name, ok, detail }); console.log(ok ? "PASS" : "FAIL", name, detail ?? ""); };
const axeResults: any[] = [];
async function runAxe(page: any, label: string) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // @ts-expect-error axe injected
    const res = await axe.run(document.querySelector('[data-testid="assistant-panel"]') ?? document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes.slice(0, 2).map((n: any) => n.target.join(" ")) }));
  });
  axeResults.push({ screen: label, violations: r });
  check(`axe ${label}`, r.length === 0, r.map((v: any) => `${v.id}x${v.nodes}`).join(","));
}
const shot = async (page: any, name: string) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(OUT, name) }); console.log("wrote", name); };
const ask = async (page: any, text: string) => { await page.fill('[data-testid="assistant-input"]', text); await page.click('[data-testid="assistant-send"]'); };

async function scenarioSet(browser: any, tag: string, o: Opts, behaviours: boolean) {
  const { page, ctx } = await newPage(browser, o);
  try {
    await shot(page, `assistant-${tag}-1-closed.png`);
    await page.click('[data-testid="assistant-fab"]');
    await page.waitForSelector('[data-testid="assistant-suggestion-roadmap-how"]');
    await shot(page, `assistant-${tag}-2-open.png`);
    await runAxe(page, `${tag} open`);
    const focusedInside = await page.evaluate(() => !!document.activeElement?.closest('[data-testid="assistant-panel"]'));
    check(`${tag}: focus moves into the dialog on open`, focusedInside);
    const panel = await page.evaluate(() => { const r = document.querySelector('[data-testid="assistant-panel"]')!.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.x, y: r.y, vw: innerWidth, vh: innerHeight }; });
    if (o.width < 768) check(`${tag}: full-height sheet on mobile`, panel.w === panel.vw && Math.abs(panel.h - panel.vh) < 2, JSON.stringify(panel));
    else check(`${tag}: panel is a bottom-right drawer on desktop`, panel.w <= 400 && panel.x + panel.w <= panel.vw, JSON.stringify(panel));
    await page.click('[data-testid="assistant-suggestion-roadmap-how"]');
    await page.waitForSelector('[data-testid="assistant-answer"]');
    await shot(page, `assistant-${tag}-3-conversation.png`);
    const label = await page.textContent('[data-testid="assistant-mode-label"]');
    check(`${tag}: local answer labelled as guide, not AI`, /Lumière|Guide/.test(label ?? "") && !/\bAI\b|\bIA\b/.test(label ?? ""), label ?? "");
    const rel = await page.getAttribute('[data-testid="assistant-sources"] a', "rel");
    check(`${tag}: source link rel=noopener`, /noopener/.test(rel ?? ""));
    if (behaviours) {
      // history sent on a second turn
      await ask(page, "Second question");
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="assistant-answer"]').length === 2);
      check("second request carries history", Array.isArray(bodies.at(-1)?.history) && bodies.at(-1).history.length === 2, JSON.stringify(bodies.at(-1)?.history?.map((h: any) => h.role)));
      check("request has only message/language/history", Object.keys(bodies.at(-1)).every((k) => ["message", "language", "history"].includes(k)));
      // 429, 503
      await ask(page, "THROTTLE please");
      await page.waitForSelector('[data-testid="assistant-throttled"]');
      check("429 shows throttled state", true);
      await shot(page, `assistant-${tag}-4-throttled.png`);
      check("composer disabled while cooling", await page.isDisabled('[data-testid="assistant-input"]'));
      await page.click('[data-testid="assistant-clear"]');
      await ask(page, "DOWN please");
      await page.waitForSelector('[data-testid="assistant-unavailable"]');
      check("503 shows unavailable state + support link", (await page.locator('[data-testid="assistant-support-link"]').count()) === 1);
      await shot(page, `assistant-${tag}-5-unavailable.png`);
      await page.click('[data-testid="assistant-clear"]');
      // Tab trap
      const n = 14;
      let escaped = false;
      for (let i = 0; i < n; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="assistant-panel"]')))) escaped = true; }
      check("Tab never leaves the dialog", !escaped);
      escaped = false;
      for (let i = 0; i < n; i++) { await page.keyboard.press("Shift+Tab"); if (!(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="assistant-panel"]')))) escaped = true; }
      check("Shift+Tab never leaves the dialog", !escaped);
      // Esc + focus return
      await page.keyboard.press("Escape");
      await page.waitForSelector('[data-testid="assistant-panel"]', { state: "detached" });
      check("Escape closes", true);
      check("focus returns to the button", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "assistant-fab");
      // reopen: conversation survives close
      await page.click('[data-testid="assistant-fab"]');
      await page.waitForSelector('[data-testid="assistant-panel"]');
      await page.click('[data-testid="assistant-close"]');
      await page.waitForSelector('[data-testid="assistant-panel"]', { state: "detached" });
      check("Close button closes + focus returns", (await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))) === "assistant-fab");
      // overlap: button must not cover the Support page's primary action or the bottom nav
      const fab = await page.evaluate(() => { const r = document.querySelector('[data-testid="assistant-fab"]')!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });
      const nav = await page.evaluate(() => { const e = document.querySelector('[data-testid="student-bottom-nav"]'); return e && getComputedStyle(e).display !== "none" ? e.getBoundingClientRect().top : null; });
      if (nav !== null) check(`${tag}: button sits above the bottom nav`, fab.bottom <= nav - 8, `fab.bottom=${fab.bottom} nav.top=${nav}`);
      const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth);
      check(`${tag}: no horizontal page scroll`, !overflow);
    }
  } catch (e) {
    check(`${tag}: scenario`, false, (e as Error).message);
  } finally { await ctx.close(); }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    await scenarioSet(browser, "desktop-1440-lumiere", { width: 1440, height: 900, theme: "lumiere" }, true);
    await scenarioSet(browser, "desktop-1440-dark", { width: 1440, height: 900, theme: "lumiere-dark" }, false);
    await scenarioSet(browser, "desktop-1440-fr", { width: 1440, height: 900, theme: "lumiere", lang: "fr" }, false);
    await scenarioSet(browser, "mobile-390-lumiere", { width: 390, height: 844, theme: "lumiere" }, true);
    await scenarioSet(browser, "mobile-390-dark", { width: 390, height: 844, theme: "lumiere-dark" }, false);
    await scenarioSet(browser, "mobile-390-fr", { width: 390, height: 844, theme: "lumiere", lang: "fr" }, false);
    await scenarioSet(browser, "mobile-390-reduced-motion", { width: 390, height: 844, theme: "lumiere", reduced: true }, false);
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
  fs.writeFileSync(path.join(OUT, "assistant-render-notes.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "LOCAL UI SIMULATION. Synthetic fixtures; stubbed auth and /api (incl. /api/assistant/*); real Student shell rendered by a local vite dev server with the assistant mounted in a sibling root by a harness. Not a deployment; no AI model was called.",
    checks, axe: axeResults,
  }, null, 2));
  if (checks.some((c) => !c.ok)) process.exit(1);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
