/**
 * Opt-in, staging-only synthetic smoke. No payments, email delivery, invented
 * electives, or roadmap publication. Credentials live only in process memory.
 * Run through Node with --import tsx. Never run against another environment.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
import { buildApplicationEnvironment, validateStartupEnvironment } from "./guard.mjs";
import { buildIdentities, newRunId, cleanupRun } from "../s22/hosted-journey.ts";
import { makeHostedTarget } from "../s22/journey/types.ts";
import { createHostedOps, createAppSessions } from "../s22/journey/hosted-ops.ts";
import { Http } from "../s22/journey/http.ts";
import { Ctx } from "../s22/journey/ctx.ts";
import { documentPdf } from "../s22/journey/fixtures.ts";

const REF = "tqgwoyzlnkqwkcjsiocd";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const result = {};
const runId = newRunId();
let ops, ctx;
const createdAuthIds = [];
const requireCheck = (condition, code) => { if (!condition) throw new Error(code); };
const evidencePath = `docs/recovery/s22-evidence/first-student-smoke-${runId}.json`;

async function browserLogin(identity, role, sid) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "s22-browser-"));
  let chrome, socket;
  const outcomes = {};
  try {
    chrome = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
      "--remote-debugging-port=9237", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    chrome.on("error", () => {});
    let page;
    for (let n = 0; n < 60; n++) {
      try {
        const response = await fetch("http://127.0.0.1:9237/json/new?about:blank", { method: "PUT" });
        if (response.ok) { page = await response.json(); break; }
      } catch { /* browser starting */ }
      await sleep(200);
    }
    requireCheck(page, "BROWSER_UNAVAILABLE");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    let next = 0, blocked = 0;
    const pending = new Map();
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error("BROWSER_COMMAND_TIMEOUT")); }
      }, 15000).unref();
    });
    const allowed = (raw) => {
      const p = new URL(raw).pathname;
      return ["/api/auth/login", "/api/csrf-token", "/api/me", "/api/student/programs",
        "/api/students/me", "/api/students/me/profile"].includes(p)
        || p.startsWith("/api/student/")
        || p === `/api/students/${sid}` || p.startsWith(`/api/students/${sid}/`)
        || p === `/api/admin/students/${sid}` || p.startsWith(`/api/admin/students/${sid}/`)
        || p === `/api/documents/student/${sid}` || p.startsWith(`/api/documents/student/${sid}/`);
    };
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.id && pending.has(message.id)) {
        const handler = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) handler.reject(new Error("BROWSER_COMMAND_FAILED"));
        else handler.resolve(message.result);
      } else if (message.method === "Fetch.requestPaused") {
        const p = message.params;
        if (allowed(p.request.url)) command("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
        else {
          blocked++;
          command("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {});
        }
      }
    });
    await command("Page.enable");
    await command("Runtime.enable");
    // Global/admin lists are intentionally blocked before reaching the server.
    await command("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*", requestStage: "Request" }] });
    const evaluate = async (expression) => {
      const response = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      requireCheck(!response.exceptionDetails, "BROWSER_EVALUATION_FAILED");
      return response.result?.value;
    };
    const poll = async (expression) => {
      for (let n = 0; n < 80; n++) {
        try { const value = await evaluate(expression); if (value) return value; } catch {}
        await sleep(250);
      }
      return null;
    };
    const base = "http://127.0.0.1:5000";
    await command("Page.navigate", { url: `${base}/login` });
    requireCheck(await poll(`!!document.querySelector('input[type="email"]') && !!document.querySelector('input[type="password"]') && !!document.querySelector('button[type="submit"]')`), "LOGIN_FORM_UNAVAILABLE");
    const input = JSON.stringify({ email: identity.email, password: identity.password });
    await evaluate(`(()=>{const x=${input};const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [type,value] of [['email',x.email],['password',x.password]]){const el=document.querySelector('input[type="'+type+'"]');set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}document.querySelector('button[type="submit"]').click();return true})()`);
    const expectedLanding = role === "admin" ? "/admin" : role === "staff" ? "/support" : "/flight-deck";
    const renderedSession = `(()=>{try{const x=JSON.parse(localStorage.getItem('lumiere_auth')||'null');return x?.user?.role===${JSON.stringify(role)}&&!!x?.session?.access_token&&location.pathname===${JSON.stringify(expectedLanding)}&&!!document.querySelector('h1')&&!document.querySelector('[data-testid="hs-flight-deck-error"]')}catch{return false}})()`;
    requireCheck(await poll(renderedSession), "UI_SIGNIN_FAILED");
    outcomes.signIn = "PASS";
    outcomes.landing = await evaluate(`location.pathname`);
    outcomes.dashboard = role === "admin" ? "shell rendered; global list requests blocked"
      : role === "staff" ? "staff support screen rendered" : "synthetic student dashboard rendered";
    await command("Page.reload");
    requireCheck(await poll(renderedSession), "UI_SESSION_RELOAD_FAILED");
    outcomes.sessionReload = "PASS";
    if (role === "admin") {
      await command("Page.navigate", { url: `${base}/admin/students/${sid}` });
      requireCheck(await poll(`!!document.querySelector('[data-testid="button-activate-lead"]')`), "UI_LEAD_ACTION_MISSING");
      await evaluate(`document.querySelector('[data-testid="button-activate-lead"]').click();true`);
      requireCheck(await poll(`document.body.innerText.includes('Lead activated.')&&!document.querySelector('[data-testid="button-activate-lead"]')`), "UI_LEAD_ACTIVATION_FAILED");
      outcomes.leadActivation = "PASS";
    }
    if (role === "staff") {
      await command("Page.navigate", { url: `${base}/admin/students/${sid}/high-school?tab=results` });
      requireCheck(await poll(`!!document.querySelector('[data-testid="input-staff-document-file"]')&&!document.querySelector('[data-testid="button-activate-lead"]')`), "UI_STAFF_UPLOAD_MISSING");
      await evaluate(`(()=>{window.__s22Paths=[];const original=window.fetch;window.fetch=async(...args)=>{const r=await original(...args);if(String(args[0]).includes('/upload-url')&&r.ok){const x=await r.clone().json();if(x.storage_path)window.__s22Paths.push(x.storage_path);}return r;};return true})()`);
      const fixturePath = path.join(profile, `s22-${runId}-ui.pdf`);
      fs.writeFileSync(fixturePath, documentPdf(runId));
      await evaluate(`(()=>{const el=document.querySelector('#staff-upload-document-type');el.value='other';el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
      const document = await command("DOM.getDocument");
      const inputNode = await command("DOM.querySelector", { nodeId: document.root.nodeId, selector: '[data-testid="input-staff-document-file"]' });
      await command("DOM.setFileInputFiles", { nodeId: inputNode.nodeId, files: [fixturePath] });
      try {
        requireCheck(await poll(`document.body.innerText.includes('File uploaded. It is pending review')`), "UI_STAFF_UPLOAD_FAILED");
        outcomes.uploadOnBehalf = "PASS";
      } finally {
        const paths = await evaluate(`window.__s22Paths||[]`);
        for (const stored of paths) ctx.track("storagePaths", stored);
      }
      const capture = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      const screenshotPath = evidencePath.replace(".json", "-staff.png");
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      fs.writeFileSync(screenshotPath, Buffer.from(capture.data, "base64"));
      outcomes.screenshot = screenshotPath;
      outcomes.unrelatedApiRequestsBlocked = blocked;
      return outcomes;
    }
    const destination = role === "admin" ? `/admin/students/${sid}/high-school` : "/documents";
    await command("Page.navigate", { url: `${base}${destination}` });
    const contentReady = role === "admin"
      ? `!!document.querySelector('[data-testid="hs-summary"]')`
      : `!!document.querySelector('[data-testid="text-page-title"]')&&document.body.innerText.includes(${JSON.stringify(`s22-${runId}-staff.pdf`)})`;
    requireCheck(await poll(`location.pathname===${JSON.stringify(destination)} && document.readyState==='complete' && (${contentReady})`), "UI_SCOPED_ROUTE_FAILED");
    outcomes.scopedNavigation = "PASS";
    const capture = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const screenshotPath = evidencePath.replace(".json", `-${role}.png`);
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
    fs.writeFileSync(screenshotPath, Buffer.from(capture.data, "base64"));
    outcomes.screenshot = screenshotPath;
    if (role === "student") {
      await command("Page.navigate", { url: `${base}/admin` });
      requireCheck(await poll(`document.readyState==='complete'&&location.pathname==='/flight-deck'&&!!document.querySelector('h1')`), "UI_ADMIN_ISOLATION_FAILED");
      outcomes.adminRouteDenied = "PASS";
    }
    outcomes.unrelatedApiRequestsBlocked = blocked;
  } catch (error) {
    outcomes.failure = /^[A-Z_]+$/.test(error.message) ? error.message : "BROWSER_TEST_FAILED";
  } finally {
    try { socket?.close(); } catch {}
    if (chrome) {
      chrome.kill("SIGTERM");
      await sleep(500);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    fs.rmSync(profile, { recursive: true, force: true });
  }
  return outcomes;
}

try {
  requireCheck(process.argv.includes("--execute"), "EXPLICIT_EXECUTE_REQUIRED");
  // No inherited managed connection or PG defaults are allowed in this runner.
  requireCheck(!("DATABASE_URL" in process.env) && !Object.keys(process.env).some((k) => /^PG/.test(k)), "INHERITED_DATABASE_ENV_REFUSED");
  validateStartupEnvironment(process.env);
  const env = buildApplicationEnvironment(process.env);
  const target = makeHostedTarget(env);
  requireCheck(target.guardPassed && target.ref === REF && env.EMAIL_ENABLED === "false", "STAGING_IDENTITY_REFUSED");
  const db = new URL(env.DATABASE_URL);
  requireCheck(db.hostname === "aws-0-us-east-2.pooler.supabase.com" && db.searchParams.get("sslmode") === "require", "STAGING_TLS_REFUSED");
  result.guard = "PASS";
  const ids = buildIdentities(runId, { domain: "s22.invalid" });
  ops = createHostedOps(target, env);
  const http = new Http({ target, timeoutMs: 20000 });
  ctx = new Ctx(target, runId, http, ops, createAppSessions(http), { directStorage: true, pace: false }, ids);
  const anon = createClient(target.supabaseUrl, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const directSession = async (key) => {
    const auth = await anon.auth.signInWithPassword({ email: ids[key].email, password: ids[key].password });
    requireCheck(!auth.error && auth.data.session && auth.data.user, "SYNTHETIC_AUTH_FAILED");
    const session = { key, userId: auth.data.user.id, email: ids[key].email,
      bearer: auth.data.session.access_token, csrf: "", issuedAt: Date.now() };
    const csrf = await http.app("GET", "/api/csrf-token", { session });
    requireCheck(csrf.status === 200 && csrf.json?.csrfToken, "SYNTHETIC_CSRF_FAILED");
    session.csrf = csrf.json.csrfToken;
    ctx.sessions_[key] = session;
    return auth.data.session;
  };
  for (const key of ["admin", "staff", "studentB"]) {
    const user = await ops.createAuthUser({ ...ids[key], confirmed: true });
    ids[key].userId = user.id;
    createdAuthIds.push(user.id);
    ctx.track("authUserIds", user.id);
    await directSession(key);
  }
  result.syntheticRolesProvisioned = "PASS";
  const staffDenied = await ctx.post("staff", "/api/admin/invitations", { email: ids.studentA.email });
  const studentDenied = await ctx.post("studentB", "/api/admin/invitations", { email: ids.studentA.email });
  requireCheck(staffDenied.status === 403 && studentDenied.status === 403, "INVITATION_ROLE_ISOLATION_FAILED");
  result.invitationRoleIsolation = "PASS";
  const invite = await ctx.post("admin", "/api/admin/invitations", { email: ids.studentA.email });
  requireCheck([200, 201].includes(invite.status) && invite.json?.token && invite.json?.id, "INVITATION_CREATE_FAILED");
  ctx.track("invitationIds", String(invite.json.id));
  result.adminInvitation = "PASS";
  const signup = await ctx.post(null, "/api/auth/signup", { email: ids.studentA.email,
    password: ids.studentA.password, fullName: ids.studentA.fullName, invitationToken: invite.json.token });
  requireCheck(signup.status === 200 && signup.json?.success && signup.json?.user?.id, "INVITED_SIGNUP_FAILED");
  ids.studentA.userId = signup.json.user.id;
  createdAuthIds.push(ids.studentA.userId);
  ctx.track("authUserIds", ids.studentA.userId);
  if (!await ops.isEmailConfirmed(ids.studentA.userId)) {
    const verification = await ops.generateVerificationToken(ids.studentA.email);
    requireCheck(verification?.tokenHash, "VERIFICATION_LINK_FAILED");
    let verified = await ctx.post(null, "/api/auth/verify-email", { token_hash: verification.tokenHash, type: "email" });
    if (verified.status !== 200) verified = await ctx.post(null, "/api/auth/verify-email", { token_hash: verification.tokenHash, type: "signup" });
    requireCheck(verified.status === 200 && await ops.isEmailConfirmed(ids.studentA.userId), "EMAIL_CONFIRMATION_FAILED");
  }
  result.invitedSignupConfirmed = "PASS";
  const studentAuth = await directSession("studentA");
  const refreshed = await anon.auth.refreshSession({ refresh_token: studentAuth.refresh_token });
  requireCheck(!refreshed.error && refreshed.data.session?.access_token, "SESSION_REFRESH_FAILED");
  ctx.sessions_.studentA.bearer = refreshed.data.session.access_token;
  const me = await ctx.get("studentA", "/api/me");
  requireCheck(me.status === 200, "REFRESHED_SESSION_REJECTED");
  result.verifiedSessionAndRefresh = "PASS";
  const body = {
    status: "lead", first_name: "S22 Synthetic", middle_name: null, last_name: "Student A", preferred_name: null,
    dob: "2009-04-12", sex: null, nationality: ["FR"], gov_id_type: null, gov_id_number: null, photo_url: null,
    residency: "us", hs_completion: false, hs_path: null, hs_country: null, hs_school: null, hs_year: null, hs_doc_url: null,
    email: ids.studentA.email, phone_primary: "+15550001234", phone_secondary: null, whatsapp_primary: false,
    timezone: null, preferred_contact_channel: "email", address_country: "US", address_state: null, address_city: null,
    address_postal: null, address_line1: "1 Synthetic Way", address_line2: null, target_degree: null, target_major: null,
    start_term: null, prior_credits: false, prior_credits_est: null, prior_sources: [], transcripts_url: [],
    target_pace: null, marketing_opt_in: false, media_release: false, consent_signature: null,
  };
  const created = await ctx.post("staff", "/api/students", body);
  requireCheck(created.status === 201 && created.json?.id, "LEAD_CREATE_FAILED");
  const sid = String(created.json.id);
  ctx.track("studentIds", sid);
  ctx.track("studentCodes", String(created.json.student_code));
  const link = await ctx.post("admin", `/api/admin/students/${sid}/account/link`, { userId: ids.studentA.userId });
  requireCheck(link.status === 200, "STUDENT_LINK_FAILED");
  result.leadToActive = "PENDING_BROWSER";
  const denied = await ctx.get("studentA", "/api/admin/students");
  requireCheck(denied.status === 403, "STUDENT_ADMIN_ISOLATION_FAILED");
  result.apiRoleIsolation = "PASS";
  try {
    const doc = await ctx.uploadDocument("staff", sid, "other", `s22-${runId}-staff.pdf`, documentPdf(runId));
    const visible = await ctx.get("studentA", `/api/documents/student/${sid}`);
    result.staffUploadAndStudentVisibility = visible.status === 200 && Array.isArray(visible.json)
      && visible.json.some((d) => d.id === doc.id) ? "PASS" : "FAIL";
  } catch { result.staffUploadAndStudentVisibility = "FAIL"; }
  try {
    const root = `/api/admin/students/${sid}/high-school`;
    const enrolled = await ctx.post("staff", `${root}/enrollments`, { templateKey: "us-hs-diploma-21", templateVersion: 2, status: "active" });
    requireCheck(enrolled.status === 201 && enrolled.json?.current?.enrollment?.id, "ENROLLMENT_CREATE_FAILED");
    const eid = enrolled.json.current.enrollment.id;
    const draft = await ctx.post("staff", `${root}/enrollments/${eid}/roadmap/draft/from-template`, {});
    requireCheck(draft.status === 200 && draft.json?.current?.draft?.content, "TEMPLATE_DRAFT_FAILED");
    const content = draft.json.current.draft.content;
    const sum = (items, field) => items.reduce((n, item) => n + item[field], 0);
    result.creditProjection = {
      coreCredits: sum(content.areas.filter((a) => a.kind === "core"), "requiredHalfUnits") / 2,
      electiveCredits: sum(content.areas.filter((a) => a.kind === "elective"), "requiredHalfUnits") / 2,
      totalRequiredCredits: content.totalRequiredHalfUnits / 2,
      providedCourseCredits: sum(content.courses, "halfUnits") / 2,
      electiveCourseCount: content.courses.filter((c) => c.areaKey === "electives").length,
    };
    result.templateProjection = result.creditProjection.coreCredits === 16 && result.creditProjection.electiveCredits === 5
      && result.creditProjection.totalRequiredCredits === 21 ? "PASS" : "FAIL";
    // This deliberately incomplete synthetic draft is known to lack electives.
    // Assert rejection; never submit a complete plan for publication.
    const rejected = await ctx.post("admin", `${root}/enrollments/${eid}/roadmap/publish`, {
      expectedDraftRevision: draft.json.current.draft.draftRevision, expectedPublishedVersionId: null,
    });
    const afterRejection = await ctx.get("staff", root);
    const message = rejected.json?.error?.message ?? rejected.json?.message ?? "";
    result.incompletePublicationRejected = rejected.status === 422
      && String(message).includes("elective") && !afterRejection.json?.current?.published
      && !!afterRejection.json?.current?.draft ? "PASS" : "FAIL";
    const saved = await ctx.put("staff", `${root}/enrollments/${eid}/roadmap/draft`, {
      expectedDraftRevision: draft.json.current.draft.draftRevision, content,
    });
    result.incompleteDraftSave = saved.status === 200 ? "PASS" : "FAIL";
  } catch (error) { result.templateProjection = error.message.match(/^[A-Z_]+$/) ? error.message : "FAIL"; }
  result.planPublication = "NOT_ATTEMPTED: no approved elective offerings; no invented courses";
  const academic = await ctx.get("studentA", "/api/student/high-school");
  result.studentAcademicRead = { status: academic.status,
    requiredHalfUnits: academic.json?.credits?.requiredHalfUnits ?? null,
    coreHalfUnits: academic.json?.credits?.core?.requiredHalfUnits ?? null,
    electiveHalfUnits: academic.json?.credits?.elective?.requiredHalfUnits ?? null };
  const programs = await ctx.get("studentA", "/api/student/programs");
  result.studentHighSchoolProgram = programs.status === 200
    && programs.json?.programs?.filter((p) => p.kind === "high_school").length === 1 ? "PASS" : "FAIL";
  result.adminBrowser = await browserLogin(ids.admin, "admin", sid);
  const activated = await ctx.get("staff", `/api/students/${sid}`);
  result.leadToActive = result.adminBrowser.leadActivation === "PASS" && activated.json?.status === "active" ? "PASS" : "FAIL";
  result.staffBrowser = await browserLogin(ids.staff, "staff", sid);
  result.studentBrowser = await browserLogin(ids.studentA, "student", sid);
} catch (error) {
  result.blocker = /^[A-Z_]+$/.test(error.message) ? error.message : "STAGING_SMOKE_RUNTIME_FAILURE";
} finally {
  if (ops) {
    try {
      const dry = await cleanupRun(ops.rawSql(), ops, { runId, confirm: false, manifest: ctx?.manifest });
      requireCheck(!dry.errors.length && dry.roots.users <= 4 && dry.roots.students <= 1 && dry.roots.invitations <= 1,
        "CLEANUP_SCOPE_REFUSED");
      const cleaned = await cleanupRun(ops.rawSql(), ops, { runId, confirm: true, manifest: ctx?.manifest });
      // Also covers an Auth account whose app-row setup failed after creation.
      for (const id of createdAuthIds) await ops.deleteAuthUser(id);
      result.cleanup = cleaned.errors.length ? "FAIL" : "PASS";
      result.cleanupEvidence = { roots: cleaned.roots, storageObjects: cleaned.storageObjects, authUsers: cleaned.authUsers };
      result.syntheticAppendOnlyAuditRetained = true;
    } catch { result.cleanup = "FAIL"; }
    await ops.close().catch(() => {});
  }
  result.verdict = !result.blocker && result.cleanup === "PASS" && result.templateProjection === "PASS"
    && result.staffUploadAndStudentVisibility === "PASS" && result.studentHighSchoolProgram === "PASS"
    && result.leadToActive === "PASS" && result.staffBrowser?.uploadOnBehalf === "PASS"
    && result.incompletePublicationRejected === "PASS" && result.incompleteDraftSave === "PASS"
    && !result.adminBrowser?.failure && !result.studentBrowser?.failure
    && result.adminBrowser?.scopedNavigation === "PASS" && result.studentBrowser?.adminRouteDenied === "PASS"
    ? "PASS_PERMITTED_SAFE_JOURNEY" : "PARTIAL_OR_FAIL";
  const report = { schema: "s22-safe-first-student-smoke/v1", runId, projectRef: REF,
    recordedAt: new Date().toISOString(), results: result,
    skipped: ["payments and receipts", "invented elective courses", "roadmap publication", "official grades"],
    externalEmailSent: false, productionTouched: false };
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ results: result, evidencePath }));
}
if (result.verdict !== "PASS_PERMITTED_SAFE_JOURNEY") process.exitCode = 1;
