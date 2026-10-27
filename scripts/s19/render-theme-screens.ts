/**
 * S19 theme + brand screenshots (Billing page in Lumière Desk / Monaco Navy / Sandstone Light).
 *
 *   npx tsx scripts/s19/render-theme-screens.ts
 *
 * LOCAL UI SIMULATION: vite dev server + Playwright route interception. Auth and every /api call are stubbed
 * from SYNTHETIC fixtures (tests/helpers/s18-billing-fixtures.ts); external hosts are blocked. Not hosted acceptance.
 * Writes billing-*.png and billing-browser-results.json to docs/recovery/s19-evidence/screens/ ONLY.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { BILLING_CONFIGURED, BILLING_NOT_CONFIGURED } from "../../tests/helpers/s18-billing-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s19-evidence/screens");
const PORT = Number(process.env.S19_PORT ?? 5221);
const BASE = `http://localhost:${PORT}`;

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

type Handler = (path: string) => { status: number; body: unknown } | null;
const ok = (body: unknown) => ({ status: 200, body });
const blockedHosts = new Set<string>();

function handler(billing: { status: number; body: unknown }): Handler {
  return (p) => {
    if (p === "/api/student/billing") return billing;
    if (p === "/api/student/programs") return ok({ programs: [{ kind: "high_school", id: "e1", title: "Lumière High School Diploma (21 credits)", status: "active", current: true }] });
    if (p === "/api/students/me") return ok({ id: "s1", first_name: "Noa", last_name: "Fischer", email: "noa.fischer@synthetic.example", photo_url: null });
    if (p.startsWith("/api/documents")) return ok([]);
    if (p.startsWith("/api/tickets")) return ok({ tickets: [], pagination: { total: 0, limit: 100, offset: 0 } });
    return null;
  };
}

async function open(browser: any, o: { theme: string; width: number; handler: Handler }) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.width >= 1000 ? 900 : 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([theme]: string[]) => {
    localStorage.setItem("lumiere-portal:theme", theme!);
    localStorage.setItem("lumiere_auth", JSON.stringify({
      user: { id: "u1", email: "noa.fischer@synthetic.example", name: "Noa Fischer", role: "student" },
      session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    }));
  }, [o.theme]);
  await ctx.addInitScript("window.__name = (f) => f;");
  const writes: string[] = [];
  await ctx.route(/.*/, async (route: any) => {
    const r = route.request();
    const url = new URL(r.url());
    if (url.hostname !== "localhost") { blockedHosts.add(url.hostname); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (r.method() !== "GET") writes.push(`${r.method()} ${url.pathname}`);
    const hit = o.handler(url.pathname) ?? { status: 404, body: { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } } };
    return route.fulfill({ status: hit.status, contentType: "application/json", body: JSON.stringify(hit.body) });
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => { errors.push(e.message); console.error("pageerror:", e.message); });
  return { page, ctx, errors, writes };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    for (const theme of ["lumiere", "monaco", "sandstone"]) {
      const { page, ctx, errors } = await open(browser, { theme, width: 1440, handler: handler(ok(BILLING_CONFIGURED)) });
      await page.goto(BASE + "/billing");
      await settle(page, '[data-testid="billing-summary"]');
      await page.screenshot({ path: path.join(OUT, `theme-billing-${theme}-1440.png`) });
      if (theme === "lumiere") {
        await page.click('[data-testid="button-theme-toggle"]');
        await page.waitForSelector('[data-testid="theme-picker"]');
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, "theme-picker-lumiere-1440.png") });
        await page.keyboard.press("Escape");
        await page.click('[data-testid="button-sidebar-toggle"]');
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, "brand-sidebar-collapsed-1440.png") });
      }
      if (errors.length) console.error("pageerrors", errors);
      await ctx.close();
    }
    const m = await open(browser, { theme: "lumiere", width: 390, handler: handler(ok(BILLING_CONFIGURED)) });
    await m.page.goto(BASE + "/billing");
    await settle(m.page, '[data-testid="billing-summary"]');
    await m.page.screenshot({ path: path.join(OUT, "brand-mobile-header-390.png"), clip: { x: 0, y: 0, width: 390, height: 200 } });
    await m.ctx.close();
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!); } catch { vite.kill(); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

async function settle(page: any, selector: string) {
  await page.waitForSelector(selector, { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(600);
}
