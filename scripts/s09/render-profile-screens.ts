/**
 * Renders the real student Profile page and the staff "Profile & identity"
 * panel in Chromium from fixture data. Writes PNGs, axe-summary.json,
 * layout-audit.json (docs/recovery/s09-evidence/screens/) and the keyboard
 * pass (docs/recovery/s09-evidence/keyboard-pass.md).
 *
 *   npx tsx scripts/s09/render-profile-screens.ts
 *
 * The app shell, authentication and all /api calls are stubbed; external fonts
 * are blocked. These are renders of fixtures, not of a deployment.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { IdentityCorrectionRequestView, StudentProfileView } from "../../shared/student-profile-contract";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(import.meta.dirname, "../..");
const EVIDENCE = path.join(ROOT, "docs/recovery/s09-evidence");
const OUT = path.join(EVIDENCE, "screens");
const PORT = Number(process.env.S09_PORT ?? 5193);
const BASE = `http://localhost:${PORT}`;
const AXE = fs.readFileSync(path.join(ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
const STAFF_STUDENT_ID = "11111111-aaaa-4bbb-8ccc-000000000009";

// ── fixtures ────────────────────────────────────────────────────────────────
const PENDING: IdentityCorrectionRequestView = {
  id: "corr-0001", studentId: STAFF_STUDENT_ID, status: "pending", fields: ["last_name", "gov_id_number"],
  currentDisplay: { last_name: "Hart", gov_id_number: "•••• 4421" },
  requestedDisplay: { last_name: "Hart-Nguyen", gov_id_number: "•••• 8830" },
  reason: "My legal surname changed after marriage; the new passport is attached.", evidenceDocumentId: "doc-id-1",
  createdAt: "2026-10-22T14:05:00.000Z", reviewedAt: null, reviewNote: null, reviewerUserId: null,
};
const OLD_REJECTED: IdentityCorrectionRequestView = {
  ...PENDING, id: "corr-0000", status: "rejected", fields: ["dob"], currentDisplay: { dob: "1994-03-02" }, requestedDisplay: { dob: "1994-03-12" },
  reason: "Typo in date of birth.", evidenceDocumentId: null, createdAt: "2026-09-01T10:00:00.000Z", reviewedAt: "2026-09-02T09:00:00.000Z",
  reviewNote: "The passport shows 2 March 1994; no change needed.", reviewerUserId: "staff-1",
};

function staffProfile(): StudentProfileView {
  return {
    identity: {
      studentId: STAFF_STUDENT_ID, studentCode: "LUM-2026-0009", firstName: "Amelia", middleName: null, lastName: "Hart", preferredName: "Amy",
      dob: "1994-03-02", sex: "Female", nationality: ["United States"], govIdType: "Passport", govIdNumberMasked: "•••• 4421", photoUrl: null,
      verification: "pending", pendingCorrection: PENDING, lastResolvedCorrection: OLD_REJECTED,
    },
    contact: {
      email: "amelia.hart@example.com", emailVerified: true, phonePrimary: "+1 512 555 0142", phoneSecondary: null, whatsappPrimary: true,
      timezone: "America/Chicago", preferredContactChannel: "whatsapp", addressLine1: "14 Larkspur Lane", addressLine2: null, addressCity: "Austin",
      addressState: "TX", addressPostal: "78701", addressCountry: "US", marketingOptIn: false, mediaRelease: false,
    },
    contacts: [
      { id: "c1", type: "guardian", fullName: "Marta Hart", relationship: "Mother", phone: "+1 512 555 0110", email: "marta@example.com", language: "English",
        requestedScopes: ["emergency", "academic", "financial"], effectiveScopes: ["emergency"], authorityStatus: "pending_verification",
        authorityVerifiedAt: null, authorityNote: null, hasPortalAccess: false, createdAt: "2026-10-20T10:00:00.000Z" },
      { id: "c2", type: "emergency", fullName: "Diego Ruiz", relationship: "Friend", phone: "+1 512 555 0177", email: null, language: null,
        requestedScopes: ["emergency"], effectiveScopes: ["emergency"], authorityStatus: "listed", authorityVerifiedAt: null, authorityNote: null,
        hasPortalAccess: false, createdAt: "2026-10-01T10:00:00.000Z" },
    ],
    academicBackground: {
      highSchool: { completionRecorded: true, path: "local_diploma", school: "Westlake High", country: "US", year: 2012, evidence: "verified" },
      priorCredentials: [], priorCreditsReported: false, foreignEvaluation: "not_submitted", collegeTranscripts: "not_submitted", degreeCertificate: "not_submitted",
    },
    eligibility: { residency: "us", residencyEvidence: "verified", englishProficiency: { meetsRequirement: true, proofType: "native", evidence: "not_submitted" }, documents: [] },
    readiness: [], account: { role: "student", twoFactorAvailable: false }, generatedAt: "2026-10-26T12:00:00.000Z",
  };
}

async function loadStudentFixtures(): Promise<{ RICH: any; NEW: any; RESOLVED: any; source: string }> {
  try {
    const mod: any = await import("../../tests/helpers/s09-profile-ui-fixtures");
    return { RICH: mod.RICH_PROFILE, NEW: mod.NEW_STUDENT_PROFILE, RESOLVED: mod.RESOLVED_PROFILE, source: "tests/helpers/s09-profile-ui-fixtures.ts" };
  } catch {
    const rich = staffProfile();
    const clone = (p: StudentProfileView, over: Partial<StudentProfileView["identity"]>): StudentProfileView =>
      ({ ...p, identity: { ...p.identity, ...over } });
    return {
      RICH: clone(rich, { pendingCorrection: null, lastResolvedCorrection: null, verification: "verified" }),
      NEW: { ...clone(rich, { pendingCorrection: null, lastResolvedCorrection: null, verification: "not_submitted", govIdNumberMasked: null }), contacts: [] },
      RESOLVED: clone(rich, { pendingCorrection: null, lastResolvedCorrection: { ...PENDING, status: "approved", reviewedAt: "2026-10-24T09:00:00.000Z", reviewNote: "Passport checked." }, verification: "verified" }),
      source: "built-in fallback fixtures (contract types)",
    };
  }
}

// ── vite + page helpers ─────────────────────────────────────────────────────
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

interface Opts { theme: "light" | "dark"; width: number; height: number; role?: "student" | "admin"; profile?: any; staff?: boolean }

const workspacePayload = () => ({
  student: { id: STAFF_STUDENT_ID, first_name: "Amelia", last_name: "Hart", email: "amelia.hart@example.com", student_code: "LUM-2026-0009" },
  report: { status: "IN_PROGRESS" },
  needsAttention: { groups: {}, diagnostics: [], integrationDiagnostics: [], reasons: [] },
  academicDetail: { academicSources: [], creditRecords: [], placements: [] },
  displayLabels: {}, program: null, snapshot: null,
});

async function newPage(browser: any, o: Opts) {
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1 });
  const role = o.role ?? "student";
  await ctx.addInitScript(([theme, r]: string[]) => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("lumiere_auth", JSON.stringify({
      user: { id: "u1", email: "amelia.hart@example.com", name: r === "admin" ? "Synthetic Admin" : "Amelia Hart", role: r },
      session: { access_token: "stub", expires_at: Math.floor(Date.now() / 1000) + 3600 },
    }));
  }, [o.theme, role]);
  await ctx.route(/.*/, async (route: any) => {
    const url = new URL(route.request().url());
    if (url.hostname !== "localhost") return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const json = (status: number, body: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    const p = url.pathname;
    if (p === "/api/students/me") return json(200, { id: "s1", first_name: "Amelia", last_name: "Hart", email: "amelia.hart@example.com", photo_url: null });
    if (p === "/api/students/me/profile") return json(200, o.profile);
    if (p === `/api/students/${STAFF_STUDENT_ID}/profile`) return json(200, staffProfile());
    if (p === `/api/students/${STAFF_STUDENT_ID}/identity-corrections`) return json(200, [PENDING, OLD_REJECTED]);
    if (p === `/api/admin/students/${STAFF_STUDENT_ID}/workspace`) return json(200, workspacePayload());
    if (p.startsWith("/api/documents")) return json(200, []);
    if (p.startsWith("/api/tickets")) return json(200, { tickets: [], total: 0 });
    return json(404, { error: { code: "STUB_NOT_FOUND", message: "not stubbed" } });
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e: Error) => console.error("pageerror:", e.message));
  return { page, ctx };
}

async function settle(page: any, selector: string) {
  await page.waitForSelector(selector, { timeout: 25_000 });
  await page.evaluate(() => (document as any).fonts?.ready);
  await page.waitForTimeout(500);
}

async function shot(page: any, name: string, full = true) {
  if (full) {
    const h = await page.evaluate(() => {
      const main = document.querySelector("main") as HTMLElement | null;
      return Math.max(main ? main.scrollHeight + 90 : 0, document.body.scrollHeight);
    });
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.width, height: Math.min(Math.max(h, vp.height), 7000) });
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, name) });
    await page.setViewportSize(vp);
  } else {
    await page.screenshot({ path: path.join(OUT, name) });
  }
  console.log("wrote", name);
}

async function runAxe(page: any, label: string, results: any[]) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    // @ts-ignore
    const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] } });
    return res.violations.map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n: any) => ({ target: n.target.join(" "), summary: n.failureSummary?.split("\n").slice(0, 3).join(" ") })) }));
  });
  results.push({ screen: label, violationCount: r.length, violations: r });
  console.log("axe", label, r.map((v: any) => `${v.id}(${v.impact})x${v.nodes}`).join(", ") || "clean");
}

const STUDENT_READY = '[data-testid="profile-header"]';
const STAFF_READY = "#workspace-profile";

async function keyboardPass(browser: any, profile: any, notes: string[]): Promise<string> {
  const { page, ctx } = await newPage(browser, { theme: "light", width: 1440, height: 900, profile });
  await page.goto(BASE + "/profile");
  await settle(page, STUDENT_READY);
  const interactiveCount = await page.evaluate(() => {
    const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), summary, [role="button"], [role="tab"]';
    return Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && !(el as any).disabled && !el.closest("[aria-hidden='true']") && !el.closest(".sr-only");
    }).length;
  });
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  const seq: any[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < interactiveCount + 12; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const st = getComputedStyle(el);
      const name = (el.getAttribute("aria-label") || el.textContent || (el as HTMLInputElement).value || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
      const outlineW = parseFloat(st.outlineWidth) || 0;
      const hasOutline = st.outlineStyle !== "none" && outlineW > 0;
      const hasRing = st.boxShadow !== "none" && /rgb/.test(st.boxShadow);
      const r = el.getBoundingClientRect();
      const path: string[] = [];
      for (let n: HTMLElement | null = el; n && path.length < 3; n = n.parentElement) path.unshift(n.tagName.toLowerCase() + (n.id ? `#${n.id}` : ""));
      return {
        tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), name, testid: el.getAttribute("data-testid"),
        focusVisible: hasOutline || hasRing, indicator: hasOutline ? `outline ${st.outlineWidth} ${st.outlineStyle}` : hasRing ? "box-shadow ring" : "none",
        onScreen: r.width > 0 && r.height > 0, key: path.join(">") + "|" + name,
      };
    });
    if (!info) { seq.push({ tag: "(document / browser chrome)", name: "", focusVisible: true, indicator: "n/a", onScreen: true, key: "body" }); if (seq.length > 3 && seq[seq.length - 2].key === "body") break; continue; }
    const first = !seen.has(info.key);
    seen.add(info.key);
    seq.push(info);
    if (!first && seq.filter((s: any) => s.key === info.key).length > 1 && seen.size >= interactiveCount) break;
  }
  const real = seq.filter((s) => s.key !== "body");
  const unique = new Set(real.map((s) => s.key));
  const noIndicator = real.filter((s) => !s.focusVisible);
  // Anything focusable that Tab never reached?
  const unreachable = await page.evaluate((reached: string[]) => {
    const sel = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), summary';
    const reachedNames = new Set(reached);
    return Array.from(document.querySelectorAll<HTMLElement>(sel)).filter((el) => {
      const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && !(el as any).disabled && !el.closest("[aria-hidden='true']") && !el.closest(".sr-only");
    }).map((el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60) || el.tagName.toLowerCase())
      .filter((n) => !reachedNames.has(n));
  }, real.map((s) => s.name || s.tag));
  await ctx.close();

  const lines = [
    "# S09 keyboard pass — student profile",
    "",
    `Generated ${new Date().toISOString()} by \`scripts/s09/render-profile-screens.ts\` (Chromium, 1440x900, light theme, fixture data, real page code).`,
    "",
    "Method: focus is moved to the document start, then `Tab` is pressed repeatedly; after each press the active element, its accessible name and its focus indicator (computed outline or box-shadow ring) are recorded. Afterwards every visible focusable element on the page is compared with the set that Tab reached.",
    "",
    `- Visible interactive elements on the page: **${interactiveCount}**`,
    `- Distinct elements reached by Tab: **${unique.size}**`,
    `- Elements with no visible focus indicator: **${noIndicator.length}**${noIndicator.length ? " (" + noIndicator.map((n) => `${n.tag} "${n.name}"`).join("; ") + ")" : ""}`,
    `- Visible focusable elements Tab did not reach: **${unreachable.length}**${unreachable.length ? " (" + unreachable.join("; ") + ")" : ""}`,
    "",
    "## Focus sequence",
    "",
    "| # | Element | Accessible name | Focus indicator |",
    "|---|---------|-----------------|-----------------|",
    ...real.map((s, i) => `| ${i + 1} | ${s.tag}${s.role ? `[role=${s.role}]` : ""} | ${s.name.replace(/\|/g, "/") || "(none)"} | ${s.indicator} |`),
    "",
    ...notes,
  ];
  return lines.join("\n");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fx = await loadStudentFixtures();
  console.log("fixtures:", fx.source);
  const vite = await startVite();
  const browser = await chromium.launch();
  const axeResults: any[] = [];
  try {
    // 1. Student profile: 1440 and 390, light and dark.
    for (const [theme, width, height, file] of [
      ["light", 1440, 900, "01-profile-1440-light.png"], ["light", 390, 844, "02-profile-390-light.png"],
      ["dark", 1440, 900, "03-profile-1440-dark.png"], ["dark", 390, 844, "04-profile-390-dark.png"],
    ] as const) {
      const { page, ctx } = await newPage(browser, { theme, width, height, profile: fx.RICH });
      await page.goto(BASE + "/profile");
      await settle(page, STUDENT_READY);
      await shot(page, file);
      await runAxe(page, file, axeResults);
      await ctx.close();
    }

    // 2. New student (empty states) and resolved correction.
    for (const [file, profile] of [["05-profile-new-student-1440-light.png", fx.NEW], ["06-profile-resolved-correction-1440-light.png", fx.RESOLVED]] as const) {
      const { page, ctx } = await newPage(browser, { theme: "light", width: 1440, height: 900, profile });
      await page.goto(BASE + "/profile");
      await settle(page, STUDENT_READY);
      await shot(page, file);
      await runAxe(page, file, axeResults);
      await ctx.close();
    }

    // 3. Correction dialog and add-contact dialog.
    for (const [file, testid, profile, theme] of [
      ["07-correction-dialog-1440-light.png", "button-request-correction", fx.RESOLVED, "light"],
      ["08-correction-dialog-390-dark.png", "button-request-correction", fx.RESOLVED, "dark"],
      ["09-add-contact-dialog-1440-light.png", "button-add-contact", fx.RICH, "light"],
    ] as const) {
      const width = file.includes("390") ? 390 : 1440;
      const { page, ctx } = await newPage(browser, { theme, width, height: width === 390 ? 844 : 900, profile });
      await page.goto(BASE + "/profile");
      await settle(page, STUDENT_READY);
      const btn = page.locator(`[data-testid="${testid}"]`).first();
      if (await btn.count()) {
        await btn.scrollIntoViewIfNeeded();
        await btn.click();
        await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
        await page.waitForTimeout(400);
        await shot(page, file, false);
        await runAxe(page, file, axeResults);
      } else {
        console.warn(`SKIP ${file}: button ${testid} not found`);
        axeResults.push({ screen: file, skipped: `button ${testid} not found` });
      }
      await ctx.close();
    }

    // 4. Mobile jump menu.
    {
      const { page, ctx } = await newPage(browser, { theme: "light", width: 390, height: 844, profile: fx.RICH });
      await page.goto(BASE + "/profile");
      await settle(page, STUDENT_READY);
      await page.locator('[data-testid="jump-menu"] button').click();
      await page.waitForTimeout(300);
      await shot(page, "10-mobile-jump-menu-390-light.png", false);
      await runAxe(page, "10-mobile-jump-menu-390-light.png", axeResults);
      await ctx.close();
    }

    // 5. Staff review panel with a pending correction.
    for (const [theme, file] of [["light", "11-staff-profile-review-1440-light.png"], ["dark", "12-staff-profile-review-1440-dark.png"]] as const) {
      const { page, ctx } = await newPage(browser, { theme, width: 1440, height: 900, role: "admin" });
      await page.goto(`${BASE}/admin/students/${STAFF_STUDENT_ID}`);
      await settle(page, STAFF_READY);
      await page.waitForSelector('[data-testid="pending-correction"]', { timeout: 10_000 });
      await shot(page, file);
      await runAxe(page, file, axeResults);
      if (theme === "light") {
        // Confirmation dialog for a rejection (note required).
        await page.getByRole("button", { name: /Reject…/ }).first().click();
        await page.waitForSelector('[role="dialog"]');
        await page.waitForTimeout(300);
        await shot(page, "13-staff-reject-confirmation-1440-light.png", false);
        await runAxe(page, "13-staff-reject-confirmation-1440-light.png", axeResults);
      }
      await ctx.close();
    }
    {
      const { page, ctx } = await newPage(browser, { theme: "light", width: 390, height: 844, role: "admin" });
      await page.goto(`${BASE}/admin/students/${STAFF_STUDENT_ID}`);
      await settle(page, STAFF_READY);
      await shot(page, "14-staff-profile-review-390-light.png");
      await runAxe(page, "14-staff-profile-review-390-light.png", axeResults);
      await ctx.close();
    }

    // 6. Layout audit.
    const audit: any[] = [];
    for (const width of [1440, 1024, 768, 390]) {
      for (const [route, role, sel, label] of [
        ["/profile", "student", STUDENT_READY, "student profile"], [`/admin/students/${STAFF_STUDENT_ID}`, "admin", STAFF_READY, "staff profile review"],
      ] as const) {
        const { page, ctx } = await newPage(browser, { theme: "light", width, height: 900, role, profile: fx.RICH });
        await page.goto(BASE + route);
        await settle(page, sel);
        const problems = await page.evaluate(() => {
          const out: string[] = [];
          const doc = document.documentElement;
          if (doc.scrollWidth > doc.clientWidth + 1) out.push(`page scrolls horizontally: ${doc.scrollWidth} > ${doc.clientWidth}`);
          const main = document.querySelector("main") as HTMLElement | null;
          if (main && main.scrollWidth > main.clientWidth + 1) out.push(`main scrolls horizontally: ${main.scrollWidth} > ${main.clientWidth}`);
          if (out.length) {
            const panel = document.getElementById("workspace-profile");
            if (panel) {
              const prev = panel.style.display;
              panel.style.display = "none";
              const without = doc.scrollWidth > doc.clientWidth + 1;
              panel.style.display = prev;
              out.push(without ? "overflow persists with the Profile & identity panel hidden (pre-existing shell/workspace)" : "overflow caused by the Profile & identity panel");
            }
            const cw = doc.clientWidth;
            const beyond = Array.from(document.querySelectorAll<HTMLElement>("body *"))
              .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > cw + 1 && !el.closest("svg"); })
              .slice(0, 4);
            for (const el of beyond) out.push(`beyond viewport: ${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") ?? String(el.className).slice(0, 50)}] right=${Math.round(el.getBoundingClientRect().right)}`);
          }
          if (out.length && main) {
            // Name the widest elements inside <main> that force the overflow.
            const wide = Array.from(main.querySelectorAll<HTMLElement>("*"))
              .map((el) => ({ el, w: Math.round(el.getBoundingClientRect().width) }))
              .filter((x) => x.w > main.clientWidth - 70 && x.w > 0)
              .slice(0, 10);
            for (const x of wide) out.push(`wide: ${x.el.tagName.toLowerCase()}[${x.el.getAttribute("data-testid") ?? String(x.el.className).slice(0, 40)}] ${x.w}px`);
          }
          return out;
        });
        audit.push({ width, screen: label, overflow: problems.length > 0, problems });
        console.log("layout", width, label, problems.length ? problems.join(" | ") : "ok");
        await ctx.close();
      }
    }
    fs.writeFileSync(path.join(OUT, "layout-audit.json"), JSON.stringify(audit, null, 2));

    // 7. Keyboard pass.
    const md = await keyboardPass(browser, fx.RICH, []);
    fs.writeFileSync(path.join(EVIDENCE, "keyboard-pass.md"), md + "\n");
    console.log("wrote keyboard-pass.md");

    const total = axeResults.reduce((n, r) => n + (r.violationCount ?? 0), 0);
    fs.writeFileSync(path.join(OUT, "axe-summary.json"), JSON.stringify({ generatedAt: new Date().toISOString(), fixtures: fx.source, totalViolations: total, results: axeResults }, null, 2));
  } finally {
    await browser.close();
    try { process.kill(-vite.pid!, "SIGTERM"); } catch { vite.kill("SIGTERM"); }
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
