/**
 * S20 check: Student Profile in French (LOCAL UI SIMULATION, synthetic fixture, stubbed API, external hosts blocked).
 *   npx tsx scripts/s20/render-profile-fr.ts   -> docs/recovery/s20-evidence/screens/profile-fr-*.png
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { RICH_PROFILE } from "../../tests/helpers/s09-profile-ui-fixtures";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s20-evidence/screens");
const PORT = 5232;
(async () => {
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort", "--host", "localhost"], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true });
  await new Promise<void>((res) => vite.stdout!.on("data", (d) => String(d).includes("Local") && res()));
  const browser = await chromium.launch();
  const user = { id: "student-user-1", email: "amelie.laurent@synthetic.example", name: "Amélie Laurent", role: "student" };
  for (const [name, w, h] of [["profile-fr-desktop-1440", 1440, 900], ["profile-fr-mobile-390", 390, 844]] as const) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([u]: [unknown]) => {
      localStorage.setItem("lumiere-portal:theme", "lumiere"); localStorage.setItem("lumiere_language", "fr");
      localStorage.setItem("lumiere_auth", JSON.stringify({ user: u, session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
      (window as any).__name = (f: unknown) => f;
    }, [user] as [unknown]);
    await ctx.route(/.*/, (r: any) => {
      const u = new URL(r.request().url());
      if (u.hostname !== "localhost") return r.abort();
      if (!u.pathname.startsWith("/api/")) return r.continue();
      if (u.pathname === "/api/students/me/profile") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(RICH_PROFILE) });
      if (u.pathname === "/api/students/me") return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "s1", first_name: "Amélie", last_name: "Laurent", email: user.email }) });
      return r.fulfill({ status: 404, contentType: "application/json", body: "{}" });
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e: Error) => console.error("pageerror", e.message));
    await page.goto(`http://localhost:${PORT}/profile`);
    await page.waitForSelector('[data-testid="page-student-profile"]', { timeout: 30000 });
    await page.waitForTimeout(1500);
    const english = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="page-student-profile"]')!.textContent ?? "";
      return ["Needs your attention", "Contact Information", "Show details", "Legal identity", "Request a correction", "Primary phone", "Add a contact"].filter((p) => t.includes(p));
    });
    console.log(name, "english leftovers:", JSON.stringify(english));
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: w < 1000 ? false : false });
    await ctx.close();
  }
  await browser.close();
  try { process.kill(-vite.pid!); } catch { /* */ }
  process.exit(0);
})();
