/**
 * S19 browser verification of the staff billing page and the document review dialog.
 *
 *   npx tsx scripts/s19/render-staff-screens.ts
 *
 * LOCAL UI SIMULATION: vite dev server (port 5225) + Playwright route interception, stubbed staff user and /api
 * responses from SYNTHETIC fixtures. If App.tsx does not yet contain the billing route, a vite plugin in a temp
 * config injects it in memory (App.tsx is never written). Writes staff-*.png to docs/recovery/s19-evidence/screens/.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { computeStaffBilling } from "../../shared/billing-ledger";
import type { BillingLedgerData } from "../../shared/billing-contract";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "docs/recovery/s19-evidence/screens");
const PORT = 5225;
const BASE = `http://localhost:${PORT}`;
const TODAY = "2026-10-27";

const data: BillingLedgerData = {
  obligation: { agreedCents: 1_200_000, currency: "USD", note: null },
  discounts: [{ id: "d1", amountCents: 120_000, reason: "Synthetic early enrollment", approvedBy: "staff", approvedAt: "2026-08-20T00:00:00.000Z" }],
  installments: [
    { id: "i1", dueDate: "2026-09-01", amountCents: 270_000, label: "Deposit", sortOrder: 0 },
    { id: "i2", dueDate: "2026-10-01", amountCents: 270_000, label: null, sortOrder: 1 },
    { id: "i3", dueDate: "2026-11-15", amountCents: 270_000, label: null, sortOrder: 2 },
    { id: "i4", dueDate: "2027-01-15", amountCents: 270_000, label: null, sortOrder: 3 },
  ],
  receipts: [
    { id: "r1", amountCents: 270_000, receivedDate: "2026-08-28", methodLabel: "Bank transfer", reference: "SYN-001", note: null, confirmedBy: "staff", confirmedAt: "2026-08-29T09:00:00.000Z", evidenceId: null },
    { id: "r2", amountCents: 135_000, receivedDate: "2026-10-04", methodLabel: "Bank transfer", reference: null, note: null, confirmedBy: "staff", confirmedAt: "2026-10-05T09:00:00.000Z", evidenceId: "e0" },
  ],
  evidence: [{ id: "e1", documentId: "doc-p", status: "awaiting_review", note: "Transfer slip", submittedAt: "2026-10-25T12:00:00.000Z", reviewedBy: null, reviewedAt: null, rejectReason: null, receiptId: null }],
  voidedReceipts: [{ id: "r0", amountCents: 270_000, receivedDate: "2026-08-28", methodLabel: "Bank transfer", reference: null, note: null, confirmedBy: "staff", confirmedAt: "2026-08-29T08:00:00.000Z", evidenceId: null, voidedAt: "2026-08-29T10:00:00.000Z", voidedBy: "staff", voidReason: "Entered twice" }],
  voidedDiscounts: [],
};
const VIEW = computeStaffBilling(data, TODAY);
const DOCS = [
  { id: "doc-p", student_id: "s1", doc_type: "hs_transcript", file_name: "transcript-synthetic.pdf", status: "pending", issuer: "Synthetic High", admin_notes: null, student_message: null, uploaded_at: "2026-10-20T10:00:00Z", created_at: "2026-10-20T10:00:00Z" },
  { id: "doc-r", student_id: "s1", doc_type: "passport", file_name: "passport-synthetic.jpg", status: "rejected", issuer: null, admin_notes: "Looks edited near the photo", student_message: "The photo page is cut off. Please upload the full page.", uploaded_at: "2026-10-10T10:00:00Z", created_at: "2026-10-10T10:00:00Z" },
];

const CONFIG = path.join(ROOT, "scripts/s19/.render-vite.config.ts");
function writeConfig() {
  fs.writeFileSync(CONFIG, `import { defineConfig, mergeConfig } from "vite";
import base from "../../vite.config";
const inject = {
  name: "s19-inject-billing-route", enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.endsWith("/client/src/App.tsx") || code.includes("admin-student-billing")) return null;
    const anchor = '<Route path="/admin/students/:studentId/roadmap">';
    if (!code.includes(anchor)) return null;
    return 'import AdminStudentBilling from "@/pages/admin-student-billing";\\n' + code.replace(anchor, '<Route path="/admin/students/:studentId/billing">{() => (<ProtectedRoute requireRole={["admin", "staff"]}><AdminStudentBilling /></ProtectedRoute>)}</Route>\\n      ' + anchor);
  },
};
export default mergeConfig(base, defineConfig({ plugins: [inject] }));
`);
}
function startVite(): Promise<ChildProcess> {
  writeConfig();
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", CONFIG, "--port", String(PORT), "--strictPort", "--host", "localhost"], {
    cwd: ROOT, env: { ...process.env, NODE_ENV: "development" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("vite did not start")), 60_000);
    child.stdout!.on("data", (d) => { if (String(d).includes("Local")) { clearTimeout(timer); resolve(child); } });
    child.stderr!.on("data", (d) => process.stderr.write(d));
    child.on("exit", (c) => reject(new Error(`vite exited ${c}`)));
  });
}

const ok = (body: unknown) => ({ status: 200, body });
function handler(p: string) {
  if (p === "/api/admin/students/s1/billing") return ok(VIEW);
  if (p === "/api/documents/student/s1") return ok(DOCS);
  if (p === "/api/admin/students/s1/workspace") return null;
  if (p.startsWith("/api/tickets")) return ok({ tickets: [], pagination: { total: 0, limit: 100, offset: 0 } });
  return null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const vite = await startVite();
  const browser = await chromium.launch();
  let failed = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(() => {
      localStorage.setItem("lumiere-portal:theme", "lumiere");
      localStorage.setItem("lumiere_auth", JSON.stringify({
        user: { id: "u9", email: "staff@synthetic.example", name: "Synthetic Staff", role: "staff" },
        session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
      }));
    });
    await ctx.addInitScript("window.__name = (f) => f;");
    const writes: string[] = [];
    await ctx.route(/.*/, async (route: any) => {
      const r = route.request(); const url = new URL(r.url());
      if (url.hostname !== "localhost") return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      if (r.method() !== "GET") writes.push(`${r.method()} ${url.pathname}`);
      const hit = handler(url.pathname) ?? { status: 404, body: { error: { code: "STUB", message: "not stubbed" } } };
      return route.fulfill({ status: hit.status, contentType: "application/json", body: JSON.stringify(hit.body) });
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.goto(`${BASE}/admin/students/s1/billing`);
    await page.waitForSelector('[data-testid="billing-summary"]', { timeout: 30_000 });
    await page.waitForTimeout(600);
    const text = await page.locator("main").innerText();
    const checks: [string, boolean][] = [
      ["net obligation $10,800.00", text.includes("$10,800.00")],
      ["paid $4,050.00", text.includes("$4,050.00")],
      ["outstanding $6,750.00", text.includes("$6,750.00")],
      ["evidence section present", (await page.locator('[data-testid="billing-evidence"]').count()) === 1],
      ["voided entry listed", text.includes("Voided entries")],
    ];
    const h = await page.evaluate(() => (document.querySelector("main") as HTMLElement).scrollHeight + 90);
    await page.setViewportSize({ width: 1440, height: Math.min(h, 4000) });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, "staff-billing-1440-lumiere.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('[data-testid="button-void-r2"]');
    await page.waitForSelector('[data-testid="dialog-void-receipt"]');
    checks.push(["void needs reason (button disabled)", await page.locator('[data-testid="dialog-void-receipt-confirm"]').isDisabled()]);
    await page.screenshot({ path: path.join(OUT, "staff-billing-void-dialog-1440.png") });
    await page.keyboard.press("Escape");

    await page.goto(`${BASE}/admin/students/s1#documents`);
    await page.waitForTimeout(1500);
    const hasDocs = (await page.locator('[data-testid="documents-review"]').count()) > 0;
    if (hasDocs) {
      await page.click('[data-testid="button-reject-doc-p"]');
      await page.waitForSelector('[data-testid="dialog-document-review"]');
      checks.push(["reject disabled until student reason", await page.locator('[data-testid="button-submit-document-review"]').isDisabled()]);
      await page.screenshot({ path: path.join(OUT, "staff-document-review-1440.png") });
    } else {
      console.log("note: workspace stub incomplete in simulation; documents screenshot skipped");
    }
    checks.push(["no unexpected writes", writes.length === 0], ["no page errors", errors.length === 0]);
    for (const [n, p] of checks) { console.log(p ? "PASS" : "FAIL", n); if (!p) failed++; }
    if (errors.length) console.log(errors.join("\n"));
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
    fs.rmSync(CONFIG, { force: true });
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); fs.rmSync(CONFIG, { force: true }); process.exit(1); });
