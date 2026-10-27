/**
 * S18 screenshots of the real High School Flight Deck.
 *
 *   npx tsx scripts/s18/render-flight-deck-screens.ts
 *
 * LOCAL UI SIMULATION: vite dev server + Playwright route interception. Auth and every /api call are stubbed from
 * SYNTHETIC fixtures (tests/helpers/s18-flight-deck-fixtures.ts); external hosts are blocked. Not hosted acceptance.
 * Requires /flight-deck to route HS-only students to the High School Flight Deck (App.tsx wiring).
 * Writes ONLY to docs/recovery/s18-evidence/screens/.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { S18_NOT_CONFIGURED, S18_PARTIAL } from "../../tests/helpers/s18-flight-deck-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s18-evidence/screens");
const PORT = Number(process.env.S18_PORT ?? 5218);
const BASE = `http://localhost:${PORT}`;
const HS_ONLY_PROGRAMS = { programs: [{ kind: "high_school", id: "e1", title: "High School Diploma (21 credits)", status: "active", current: true }] };

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

async function capture(browser: any, o: { name: string; theme: string; width: number; projection: unknown; drawer?: boolean }) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.width >= 1000 ? 900 : 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([theme]: string[]) => {
    localStorage.setItem("theme", theme!);
    localStorage.setItem("lumiere_auth", JSON.stringify({
      user: { id: "u1", email: "noa.fischer@synthetic.example", name: "Noa Fischer", role: "student" },
      session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    }));
  }, [o.theme]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const ok = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/student/programs") return ok(HS_ONLY_PROGRAMS);
    if (url.pathname === "/api/student/academic-projection") return ok(o.projection);
    if (url.pathname === "/api/students/me") return ok({ id: "s1", first_name: "Noa", last_name: "Fischer", email: "noa.fischer@synthetic.example", photo_url: null });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "STUB_NOT_FOUND", message: "not stubbed" } }) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  await page.goto(BASE + "/flight-deck");
  await page.waitForSelector('[data-testid="high-school-flight-deck"], [data-testid="not-configured"]', { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  if (o.drawer) {
    await page.click('[data-testid="mode-projected"]');
    await page.click('[data-testid="subject-science"]');
    await page.waitForSelector('[data-testid="subject-sheet"]');
  }
  await page.waitForTimeout(600);
  if (!o.drawer) {
    const h = await page.evaluate(() => (document.querySelector("main") as HTMLElement | null)?.scrollHeight ?? 0);
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h + 90, vp.height), 6000) });
    await page.waitForTimeout(250);
  }
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth);
  await page.screenshot({ path: path.join(OUT, `${o.name}-${o.width}.png`) });
  console.log("wrote", `${o.name}-${o.width}.png`, "horizontal overflow:", overflow);
  await ctx.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    for (const width of [1440, 390]) {
      await capture(browser, { name: "hs-flight-deck-partial-lumiere", theme: "lumiere", width, projection: S18_PARTIAL });
      await capture(browser, { name: "hs-flight-deck-partial-dark", theme: "lumiere-dark", width, projection: S18_PARTIAL });
      await capture(browser, { name: "hs-flight-deck-partial-monaco", theme: "monaco", width, projection: S18_PARTIAL });
      await capture(browser, { name: "hs-flight-deck-subject-drawer-monaco", theme: "monaco", width, projection: S18_PARTIAL, drawer: true });
      await capture(browser, { name: "hs-flight-deck-not-configured-lumiere", theme: "lumiere", width, projection: S18_NOT_CONFIGURED });
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!); } catch { /* already gone */ }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
