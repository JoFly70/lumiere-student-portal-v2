// S31-A LOCAL UI SIMULATION journeys (synthetic stubs; not live). Measures visibility and click paths.
import fs from "node:fs";
import path from "node:path";

const DOCS_AS_PRESENTED = [
  { id: "d1", doc_type: "id_gov", file_name: "id.pdf", status: "verified", created_at: "2026-09-01T10:00:00Z", review_message: null },
  // Shape produced by server/lib/document-presenter.ts for a student: review_message only, student_message stripped.
  { id: "d4", doc_type: "hs_transcript", file_name: "report-card.pdf", status: "resubmit_requested", created_at: "2026-10-10T10:00:00Z", review_message: "Le relevé est illisible : merci d’envoyer un scan complet des deux pages." },
];

export async function run(browser: any, newPage: any, OUT: string, posts: any[]) {
  const log: any = {};
  const shot = (page: any, n: string) => page.screenshot({ path: path.join(OUT, `j-${n}.png`) });
  const visible = (page: any, re: RegExp) => page.evaluate((src: string) => new RegExp(src, "i").test((document.querySelector("main") as HTMLElement).innerText), re.source);

  // J5 rejection reason: Documents vs Library
  for (const screen of ["documents", "library"]) {
    const { page, ctx } = await newPage(browser, { width: 390, height: 844, theme: "lumiere", lang: "fr", persona: "hs", screen });
    await ctx.route(/\/api\/documents\/student\//, (r: any) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DOCS_AS_PRESENTED) }));
    await page.reload(); await page.waitForTimeout(2500);
    log[`J5-${screen}-reasonVisible`] = await visible(page, /illisible/);
    await shot(page, `J5-${screen}-fr-390`);
    await ctx.close();
  }

  // J3 elective change discoverability on default /high-school, then details view
  {
    const { page, ctx } = await newPage(browser, { width: 1440, height: 900, theme: "lumiere", lang: "fr", persona: "hs", screen: "hs-roadmap" });
    log["J3-default-hasChangeControl"] = await page.evaluate(() => [...document.querySelectorAll("main button, main a")].map((b) => (b as HTMLElement).innerText).filter((t) => /chang|remplac/i.test(t)));
    const details = await page.$('[data-testid="rm-details-link"]');
    log["J3-detailsLink"] = !!details;
    if (details) {
      await details.click(); await page.waitForTimeout(2500);
      log["J3-details-url"] = page.url();
      log["J3-details-changeControls"] = await page.evaluate(() => [...document.querySelectorAll("main button, main a, [role=tab]")].map((b) => (b as HTMLElement).innerText.trim()).filter((t) => /chang|remplac|option|matières|subjects/i.test(t)).slice(0, 10));
      await shot(page, "J3-details-fr-1440");
    }
    await ctx.close();
  }

  // J9 billing: is there any "how to pay" guidance?
  {
    const { page, ctx } = await newPage(browser, { width: 390, height: 844, theme: "lumiere", lang: "fr", persona: "hs", screen: "billing" });
    log["J9-howToPayText"] = await visible(page, /comment payer|virement|mode de paiement|payer en ligne|interac|carte/);
    log["J9-uploadProofLink"] = !!(await page.$('[data-testid="link-upload-proof"]'));
    log["J9-supportLink"] = await visible(page, /Soutien|Assistance/);
    await shot(page, "J9-billing-fr-390");
    await ctx.close();
  }

  // J1 first visit: what is the first actionable thing? (deck, 390 FR) + orb overlap
  {
    const { page, ctx } = await newPage(browser, { width: 390, height: 844, theme: "lumiere", lang: "fr", persona: "hs", screen: "flight-deck" });
    log["J1-welcomeOrOrientationText"] = await visible(page, /bienvenue|premiers pas|commencez par|par où commencer/);
    log["J1-orbRect"] = await page.evaluate(() => { const o = document.querySelector('[data-testid="assistant-fab"]'); return o ? o.getBoundingClientRect().toJSON() : null; });
    log["J1-bottomNav"] = await page.evaluate(() => [...document.querySelectorAll("nav a, nav button")].map((a) => { const r = a.getBoundingClientRect(); return `${(a as HTMLElement).innerText.replace(/\n/g, " ").trim() || a.getAttribute("aria-label")} ${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)}`; }).filter((s) => !s.includes("@-")).slice(-8));
    // Open "Plus" (More) menu on mobile to count where Billing/Calendar/Profile live
    const more = page.getByRole("button", { name: /plus|more/i }).last();
    if (await more.count()) { await more.click(); await page.waitForTimeout(800); log["J1-moreMenu"] = await page.evaluate(() => (document.querySelector('[role=dialog],[role=menu]') as HTMLElement | null)?.innerText.split("\n").filter(Boolean)); await shot(page, "J1-more-fr-390"); }
    await ctx.close();
  }

  // Assistant panel at 390: open, check it does not hide the bottom nav, and what the intro says
  {
    const { page, ctx } = await newPage(browser, { width: 390, height: 844, theme: "lumiere", lang: "fr", persona: "ba", screen: "flight-deck" });
    const fab = await page.$('[data-testid="assistant-fab"]');
    if (fab) {
      await fab.click(); await page.waitForTimeout(1200);
      log["AI-panelText"] = await page.evaluate(() => (document.querySelector('[data-testid="assistant-panel"]') as HTMLElement | null)?.innerText.slice(0, 600));
      await shot(page, "AI-panel-ba-fr-390");
    }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "journeys.json"), JSON.stringify(log, null, 1));
  console.log(JSON.stringify(log, null, 1));
}
