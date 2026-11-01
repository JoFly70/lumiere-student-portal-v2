// S31-A LIVE public-surface audit. Read-only: only GET navigations, plus ONE wrong-credential login attempt
// with a non-existent .invalid address to observe the error state. No signup, no reset email, no invite redemption.
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = "https://lumiere-student-portal-v-2.replit.app";
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const SIZES = [[1440, 900], [768, 1024], [390, 844]];

async function audit(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const overflowX = de.scrollWidth - de.clientWidth;
    const small = [];
    for (const el of document.querySelectorAll("a,button,input,select,textarea,[role=button]")) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden" || cs.display === "none") continue;
      if (el.type === "hidden") continue;
      if (r.height < 44 || r.width < 24) small.push(((el.innerText || el.getAttribute("aria-label") || el.placeholder || el.name || el.tagName) + "").trim().slice(0, 40) + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    const unlabeled = [];
    for (const el of document.querySelectorAll("input:not([type=hidden]),select,textarea")) {
      const id = el.id;
      const lab = (id && document.querySelector(`label[for="${id}"]`)) || el.closest("label") || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
      if (!lab) unlabeled.push(el.name || el.type || el.placeholder);
    }
    const iconBtns = [...document.querySelectorAll("button")].filter((b) => !b.innerText.trim() && !b.getAttribute("aria-label") && !b.getAttribute("title")).length;
    const h1 = [...document.querySelectorAll("h1")].map((h) => h.innerText.trim().slice(0, 60));
    return { title: document.title, lang: de.lang, overflowX, smallTargets: small.slice(0, 25), smallCount: small.length, unlabeled, iconBtnsNoName: iconBtns, h1, textLen: document.body.innerText.length };
  });
}

(async () => {
  const browser = await chromium.launch();
  const pages = [
    ["landing", "/"],
    ["login", "/login"],
    ["login-fr", "/login?lang=fr"],
    ["login-invite-fr", "/login?invite=S31AUDITFAKE&lang=fr"],
    ["reset-password", "/reset-password"],
    ["resend-verification", "/resend-verification"],
    ["flight-deck-unauth", "/flight-deck"],
    ["notfound", "/this-page-does-not-exist"],
  ];
  for (const [w, h] of SIZES) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 500, isMobile: w < 500 });
      for (const [name, p] of pages) {
        if (scheme === "dark" && !["landing", "login-fr"].includes(name)) continue; // dark only on key pages
        const page = await ctx.newPage();
        const t0 = Date.now();
        let status = null;
        try {
          const resp = await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 45000 });
          status = resp && resp.status();
        } catch (e) { status = "ERR " + e.message.slice(0, 80); }
        await page.waitForTimeout(800);
        const ms = Date.now() - t0;
        const a = await audit(page).catch((e) => ({ err: e.message }));
        const file = `${name}-${w}-${scheme}.png`;
        await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
        results.push({ name, path: p, w, scheme, status, finalUrl: page.url().replace(BASE, ""), loadMs: ms, ...a, file });
        await page.close();
      }
      await ctx.close();
    }
  }
  // Text capture of login + forgot-password flow UI at 390 (no submission of reset).
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(BASE + "/login?lang=fr", { waitUntil: "networkidle" });
  const loginText = await page.evaluate(() => document.body.innerText);
  fs.writeFileSync(`${OUT}/login-fr-text.txt`, loginText);
  const buttons = await page.evaluate(() => [...document.querySelectorAll("button,a")].map((b) => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean));
  fs.writeFileSync(`${OUT}/login-fr-controls.json`, JSON.stringify(buttons, null, 1));
  // Open "forgot password" if present, screenshot, do NOT submit.
  const forgot = page.getByText(/oubli|forgot/i).first();
  if (await forgot.count()) { await forgot.click(); await page.waitForTimeout(800); await page.screenshot({ path: `${OUT}/forgot-fr-390.png`, fullPage: true }); fs.writeFileSync(`${OUT}/forgot-fr-text.txt`, await page.evaluate(() => document.body.innerText)); }
  // One wrong-credential attempt (synthetic, non-existent .invalid address) to see the error state.
  await page.goto(BASE + "/login?lang=fr", { waitUntil: "networkidle" });
  const email = page.locator('input[type=email], input[name=email]').first();
  const pw = page.locator('input[type=password]').first();
  if (await email.count() && await pw.count()) {
    await email.fill("s31-audit-nonexistent@demo.invalid");
    await pw.fill("not-a-real-password-S31");
    const t0 = Date.now();
    await pw.press("Enter");
    await page.waitForTimeout(5000);
    fs.writeFileSync(`${OUT}/login-error-fr.json`, JSON.stringify({ ms: Date.now() - t0, url: page.url(), text: await page.evaluate(() => document.body.innerText), alerts: await page.evaluate(() => [...document.querySelectorAll('[role=alert],[aria-live]')].map((e) => e.innerText)) }, null, 1));
    await page.screenshot({ path: `${OUT}/login-error-fr-390.png`, fullPage: true });
  }
  // PWA probes
  const probes = {};
  for (const u of ["/manifest.json", "/manifest.webmanifest", "/site.webmanifest", "/sw.js", "/service-worker.js", "/apple-touch-icon.png", "/robots.txt", "/ready"]) {
    const r = await page.request.get(BASE + u).catch(() => null);
    probes[u] = r ? [r.status(), (r.headers()["content-type"] || "")] : "ERR";
  }
  const head = await page.evaluate(() => [...document.head.querySelectorAll("meta,link")].map((e) => e.outerHTML));
  fs.writeFileSync(`${OUT}/pwa-probes.json`, JSON.stringify({ probes, head }, null, 1));
  await browser.close();
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  for (const r of results) console.log(`${r.name.padEnd(22)} ${r.w} ${r.scheme.padEnd(5)} st=${r.status} → ${r.finalUrl.padEnd(28)} ${r.loadMs}ms ovX=${r.overflowX} small=${r.smallCount} unlabeled=${(r.unlabeled||[]).length} iconNoName=${r.iconBtnsNoName} lang=${r.lang} h1=${JSON.stringify(r.h1)}`);
})();
