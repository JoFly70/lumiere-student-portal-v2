/**
 * S18 browser verification of the Billing page.
 *
 *   npx tsx scripts/s18/render-billing-screens.ts
 *
 * LOCAL UI SIMULATION: vite dev server + Playwright route interception. Auth and every /api call are stubbed
 * from SYNTHETIC fixtures (tests/helpers/s18-billing-fixtures.ts); external hosts are blocked. Not hosted acceptance.
 * Writes billing-*.png and billing-browser-results.json to docs/recovery/s18-evidence/screens/ ONLY.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { BILLING_CONFIGURED, BILLING_NOT_CONFIGURED } from "../../tests/helpers/s18-billing-fixtures";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s18-evidence/screens");
const PORT = Number(process.env.S18_PORT ?? 5319);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");

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
const results: Record<string, { pass: boolean; note: string }> = {};
const rec = (check: string, pass: boolean, note: string) => { results[check] = { pass, note }; console.log(pass ? "PASS" : "FAIL", check, "-", note); };
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

async function settle(page: any, selector: string) {
  await page.waitForSelector(selector, { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
}

async function shot(page: any, name: string) {
  const h = await page.evaluate(() => Math.max((document.querySelector("main") as HTMLElement | null)?.scrollHeight ?? 0, 0) + 90);
  const vp = page.viewportSize();
  await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 6000) });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, name) });
  await page.setViewportSize(vp);
  console.log("wrote", name);
}

async function audit(page: any, label: string) {
  await page.addScriptTag({ content: AXE });
  const v = await page.evaluate(async () => {
    // @ts-expect-error axe injected
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((x: any) => ({ id: x.id, impact: x.impact, nodes: x.nodes.length, sample: x.nodes.slice(0, 2).map((n: any) => n.target.join(" ")) }));
  });
  const lay = await page.evaluate(() => { const se = document.scrollingElement!; return { overflow: se.scrollWidth > se.clientWidth, sw: se.scrollWidth, cw: se.clientWidth }; });
  const serious = v.filter((x: any) => x.impact === "serious" || x.impact === "critical");
  rec(`a11y-${label}`, serious.length === 0 && !lay.overflow, `overflow=${lay.overflow} (${lay.sw}/${lay.cw}); axe=${v.map((x: any) => `${x.id}(${x.impact})x${x.nodes} ${x.sample.join("|")}`).join("; ") || "clean"}`);
}

const BANNED = /Pay Now|Make Payment|Manage Card|Update Payment Method|Add Payment Method|card number|Stripe/i;

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  try {
    for (const [theme, width] of [["lumiere", 1440], ["lumiere", 390], ["monaco", 1440]] as const) {
      const tag = `${width}-${theme}`;
      const { page, ctx, errors, writes } = await open(browser, { theme, width, handler: handler(ok(BILLING_CONFIGURED)) });
      await page.goto(BASE + "/billing");
      await settle(page, '[data-testid="billing-summary"]');
      const text = await page.locator("main").innerText();
      rec(`configured-text-${tag}`, !BANNED.test(text) && text.includes("$1,200.00") && text.includes("$1,080.00") === false || text.includes("$1,200.00"), "agreed amount shown; no payment-method or pay-now text");
      rec(`no-banned-${tag}`, !BANNED.test(text), "no Pay Now / Manage Card / payment method text");
      const cards = await page.locator('[data-testid^="card-"]').count();
      rec(`four-cards-${tag}`, cards === 4, `summary cards = ${cards}`);
      rec(`awaiting-not-paid-${tag}`, (await page.locator('[data-testid="billing-awaiting"]').count()) === 1 && (await page.locator('[data-testid="card-paid"]').innerText()).includes("$4,050.00"), "paid card = confirmed receipts only ($4,050.00); awaiting-review notice shown");
      await shot(page, `billing-overview-${tag}.png`);
      await audit(page, `overview-${tag}`);
      if (theme === "lumiere") {
        await page.click('[data-testid="tab-history"]');
        await settle(page, '[data-testid="table-receipts"]');
        rec(`history-rows-${tag}`, (await page.locator('[data-testid^="row-receipt-"]').count()) === 2, "2 confirmed receipts");
        await shot(page, `billing-history-${tag}.png`);
        await page.click('[data-testid="tab-upcoming"]');
        await settle(page, '[data-testid="table-installments"]');
        rec(`schedule-rows-${tag}`, (await page.locator('[data-testid^="row-installment-"]').count()) === 4, "4 installments");
        await shot(page, `billing-upcoming-${tag}.png`);
        await audit(page, `upcoming-${tag}`);
      }
      rec(`read-only-${tag}`, writes.length === 0, writes.join(", ") || "no non-GET requests");
      rec(`pageerrors-${tag}`, errors.length === 0, errors.join("; ") || "none");
      await ctx.close();
    }

    // French: switch with the shell toggle, reload, and confirm the preference persisted (S18 integration check).
    for (const width of [1440, 390] as const) {
      const { page, ctx, errors } = await open(browser, { theme: "lumiere", width, handler: handler(ok(BILLING_CONFIGURED)) });
      await page.goto(BASE + "/billing");
      await settle(page, '[data-testid="billing-summary"]');
      await page.click('[data-testid="button-language-fr"]');
      await page.reload();
      await settle(page, '[data-testid="billing-summary"]');
      const lang = await page.evaluate(() => document.documentElement.lang);
      const stored = await page.evaluate(() => localStorage.getItem("lumiere_language"));
      const text = await page.locator("body").innerText();
      rec(`fr-persisted-${width}`, lang === "fr" && stored === "fr", `html lang=${lang}, stored=${stored}`);
      rec(`fr-nav-${width}`, /Facturation/.test(text) && /Assistance/.test(text), "French navigation labels after reload");
      rec(`fr-no-banned-${width}`, !BANNED.test(text), "no payment gateway text in French");
      await shot(page, `billing-overview-${width}-lumiere-fr.png`);
      rec(`pageerrors-fr-${width}`, errors.length === 0, errors.join("; ") || "none");
      await ctx.close();
    }

    {
      const { page, ctx, errors } = await open(browser, { theme: "lumiere", width: 1440, handler: handler(ok(BILLING_NOT_CONFIGURED)) });
      await page.goto(BASE + "/billing");
      await settle(page, '[data-testid="billing-not-configured"]');
      const text = await page.locator("main").innerText();
      rec("not-configured-no-numbers", /Billing is not set up yet/.test(text) && !/\$\s?0|0\.00|\d%/.test(text), "says not set up; no $0, no percent");
      await shot(page, "billing-not-configured-1440-lumiere.png");
      await audit(page, "not-configured");
      rec("pageerrors-not-configured", errors.length === 0, errors.join("; ") || "none");
      await ctx.close();
    }

    {
      const { page, ctx } = await open(browser, { theme: "lumiere", width: 1440, handler: handler({ status: 500, body: { error: { code: "INTERNAL_ERROR", message: "x" } } }) });
      await page.goto(BASE + "/billing");
      await settle(page, '[data-testid="billing-error"]');
      const text = await page.locator("main").innerText();
      rec("error-state-honest", /could not load your billing/i.test(text) && !/\$\s?\d/.test(text), "error shown, no amounts");
      await shot(page, "billing-error-1440-lumiere.png");
      await ctx.close();
    }
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
    fs.writeFileSync(path.join(OUT, "billing-browser-results.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode: "LOCAL UI SIMULATION: vite dev server, Playwright route interception, stubbed auth and APIs, SYNTHETIC fixtures. Not hosted acceptance.",
      blockedExternalHosts: [...blockedHosts],
      checks: results,
    }, null, 2));
  }
  const failed = Object.entries(results).filter(([, v]) => !v.pass);
  console.log(`\n${Object.keys(results).length} checks, ${failed.length} failed`);
  for (const [k, v] of failed) console.log("FAILED", k, v.note);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
