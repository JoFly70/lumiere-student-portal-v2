/**
 * S19 login screenshots. `npx tsx scripts/s19/render-login-screens.ts`
 * LOCAL UI SIMULATION: vite dev server (port 5222) + Playwright route interception; /api is stubbed, external hosts blocked.
 * Writes ONLY to docs/recovery/s19-evidence/screens/ (prefix login-).
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s19-evidence/screens");
const PORT = 5222;
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

interface Shot { name: string; url: string; theme: string; width: number; lang?: string; error?: boolean }

async function capture(browser: any, o: Shot) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.width >= 1000 ? 900 : 844 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(([theme, lang]: string[]) => {
    localStorage.setItem("theme", theme!);
    localStorage.setItem("lumiere_language", lang!);
  }, [o.theme, o.lang ?? "en"]);
  await ctx.addInitScript("window.__name = (f) => f;");
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (url.pathname === "/api/auth/login") return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "Invalid email or password" }) });
    return route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "not signed in" }) });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  await page.goto(BASE + o.url);
  await page.waitForSelector('[data-testid="auth-layout"]', { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  if (o.error) {
    await page.fill("#login-email", "noa.fischer@synthetic.example");
    await page.fill("#login-password", "wrong-password");
    await page.click('[data-testid="button-login"]');
    await page.waitForSelector('[role="alert"]');
  }
  await page.waitForTimeout(3500);
  const overflow = await page.evaluate(() => document.scrollingElement!.scrollWidth > document.scrollingElement!.clientWidth);
  await page.screenshot({ path: path.join(OUT, `${o.name}.png`), fullPage: o.width < 1000 });
  console.log("wrote", o.name, "overflow:", overflow);
  await ctx.close();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    const shots: Shot[] = [
      { name: "login-desktop-1440-lumiere", url: "/login", theme: "lumiere", width: 1440 },
      { name: "login-desktop-1440-monaco", url: "/login", theme: "monaco", width: 1440 },
      { name: "login-mobile-390-lumiere", url: "/login", theme: "lumiere", width: 390 },
      { name: "login-mobile-390-dark", url: "/login", theme: "lumiere-dark", width: 390 },
      { name: "login-invitation-1440", url: "/login?invite=LUM-2026-DEMO", theme: "lumiere", width: 1440 },
      { name: "login-error-1440", url: "/login", theme: "lumiere", width: 1440, error: true },
      { name: "login-french-1440", url: "/login", theme: "lumiere", width: 1440, lang: "fr" },
      { name: "login-reset-1440", url: "/reset-password", theme: "lumiere", width: 1440 },
    ];
    for (const s of shots) await capture(browser, s);
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!); } catch { /* gone */ }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
