const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  for (const locale of ["fr-CA", "fr-FR", "en-US"]) {
    const ctx = await b.newContext({ locale, viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    await p.goto("https://lumiere-student-portal-v-2.replit.app/", { waitUntil: "networkidle" });
    console.log(locale, await p.evaluate(() => document.documentElement.lang), JSON.stringify(await p.locator("h1").first().innerText()));
    await ctx.close();
  }
  await b.close();
})();
