/**
 * S19 cockpit screenshots. npx tsx scripts/s19/render-cockpit-screens.ts
 * LOCAL UI SIMULATION: vite (port 5223) + Playwright route interception with SYNTHETIC fixtures. Writes docs/recovery/s19-evidence/screens/cockpit-*.png
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { S19_BILLING, S19_DOCS, S19_NEAR_COMPLETE, S19_PARTIAL, S19_TICKETS } from "../../tests/helpers/s19-cockpit-fixtures";
import { S18_NOT_CONFIGURED } from "../../tests/helpers/s18-flight-deck-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s19-evidence/screens");
const PORT = 5223;
const BASE = `http://localhost:${PORT}`;
const PROGRAMS = { programs: [{ kind: "high_school", id: "e1", title: "High School Diploma (21 credits)", status: "active", current: true }] };

function startVite(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "localhost"], { cwd: ROOT, env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 60_000);
    child.stdout!.on("data", (d) => { if (String(d).includes("Local")) { clearTimeout(timer); resolve(child); } });
    child.stderr!.on("data", (d) => process.stderr.write(d));
    child.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}

async function capture(browser: any, o: { name: string; theme: string; width: number; projection: unknown; lang?: string; drawer?: boolean; full?: boolean }) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.width >= 1000 ? 900 : 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([theme, lang]: string[]) => {
    localStorage.setItem("theme", theme!);
    localStorage.setItem("lumiere_language", lang!);
    localStorage.setItem("lumiere_auth", JSON.stringify({ user: { id: "u1", email: "noa.fischer@synthetic.example", name: "Noa Fischer", role: "student" }, session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
  }, [o.theme, o.lang ?? "en"]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const ok = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === "/api/student/programs") return ok(PROGRAMS);
    if (p === "/api/student/academic-projection") return ok(o.projection);
    if (p === "/api/students/me") return ok({ id: "s1", student_code: "SYN-001", first_name: "Noa", last_name: "Fischer", email: "noa.fischer@synthetic.example", photo_url: null });
    if (p.startsWith("/api/documents/student/")) return ok(S19_DOCS);
    if (p === "/api/tickets") return ok(S19_TICKETS);
    if (p === "/api/student/billing") return ok(S19_BILLING);
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { code: "STUB_NOT_FOUND", message: "not stubbed" } }) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  await page.goto(BASE + "/flight-deck");
  await page.waitForSelector('[data-testid="high-school-flight-deck"], [data-testid="not-configured"]', { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(900);
  if (o.drawer) { await page.click('[data-testid="subject-science"]'); await page.waitForSelector('[data-testid="subject-sheet"]'); await page.waitForTimeout(400); }
  if (o.full) {
    const h = await page.evaluate(() => (document.querySelector("main") as HTMLElement | null)?.scrollHeight ?? 0);
    await page.setViewportSize({ width: o.width, height: Math.min(Math.max(h + 90, 844), 4000) });
    await page.waitForTimeout(250);
  }
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth);
  await page.screenshot({ path: path.join(OUT, `cockpit-${o.name}-${o.width}.png`) });
  console.log("wrote", `cockpit-${o.name}-${o.width}.png`, "overflow:", overflow);
  await ctx.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    await capture(browser, { name: "partial-lumiere", theme: "lumiere", width: 1440, projection: S19_PARTIAL });
    await capture(browser, { name: "partial-monaco", theme: "monaco", width: 1440, projection: S19_PARTIAL });
    await capture(browser, { name: "partial-french", theme: "lumiere", width: 1440, projection: S19_PARTIAL, lang: "fr" });
    await capture(browser, { name: "subject-drawer", theme: "lumiere", width: 1440, projection: S19_PARTIAL, drawer: true });
    await capture(browser, { name: "not-configured", theme: "lumiere", width: 1440, projection: S18_NOT_CONFIGURED });
    await capture(browser, { name: "near-complete", theme: "lumiere", width: 1440, projection: S19_NEAR_COMPLETE });
    await capture(browser, { name: "partial-lumiere", theme: "lumiere", width: 390, projection: S19_PARTIAL, full: true });
    await capture(browser, { name: "partial-dark", theme: "lumiere-dark", width: 390, projection: S19_PARTIAL, full: true });
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!); } catch { /* gone */ }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
