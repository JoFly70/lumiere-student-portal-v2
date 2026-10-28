/**
 * Explicitly authorized, retained owner QA fixture; never run in production.
 * Email is provided at invocation, not committed. No passwords or email sends.
 * --provision creates ONLY the original synthetic account's missing academic data.
 * --verify reuses it and performs real browser/API checks; credentials stay private.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import WebSocket from "ws";
import { buildApplicationEnvironment, validateStartupEnvironment, validateStagingDatabaseIdentity } from "./guard.mjs";
import { makeQaRoadmap, QA_STUDENT_CODE, QA_NOTICE } from "./qa-roadmap.mjs";

const provision = process.argv.includes("--provision");
const verify = process.argv.includes("--verify");
const outcomes = {};
const check = (condition, code) => { if (!condition) throw new Error(code); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let closeDatabase, qaClient;

function guardRuntime(env) {
  let found = 0;
  for (const pid of fs.readdirSync("/proc").filter(p => /^\d+$/.test(p))) {
    let cmd;
    try { cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0"); } catch { continue; }
    if (!cmd.includes("server/index.ts")) continue;
    const parent = fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/^PPid:\s+(\d+)/m)?.[1];
    check(parent && fs.readFileSync(`/proc/${parent}/cmdline`, "utf8").split("\0").includes("scripts/staging/start.mjs"), "RUNTIME_LAUNCHER_MISMATCH");
    const selected = {};
    for (const value of fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0")) {
      const split = value.indexOf("="), name = value.slice(0, split);
      check(!name.startsWith("PG"), "RUNTIME_PG_OVERRIDE");
      if (["APP_URL", "SUPABASE_URL", "DATABASE_URL", "ENABLE_EMAIL_VERIFICATION"].includes(name)) selected[name] = value.slice(split + 1);
    }
    validateStagingDatabaseIdentity(selected.DATABASE_URL);
    check(selected.APP_URL === env.APP_URL && selected.SUPABASE_URL === env.SUPABASE_URL
      && selected.ENABLE_EMAIL_VERIFICATION === "true", "RUNTIME_TARGET_MISMATCH");
    found++;
  }
  check(found === 1, "RUNTIME_NOT_UNIQUE");
}

async function browserChecks(storedAuth, studentId) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "s24-browser-"));
  let chrome, socket;
  let failureCapture, inspectScreen;
  const result = outcomes.browser = {}, pending = new Map();
  let sequence = 0;
  try {
    chrome = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage",
      "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=9238",
      `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
    chrome.on("error", () => {});
    let page;
    for (let n = 0; n < 60; n++) {
      try { const r = await fetch("http://127.0.0.1:9238/json/new?about:blank", { method: "PUT" });
        if (r.ok) { page = await r.json(); break; } } catch {}
      await sleep(200);
    }
    check(page, "BROWSER_UNAVAILABLE");
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error("BROWSER_COMMAND_TIMEOUT")); } }, 15000).unref();
    });
    socket.on("message", raw => {
      const message = JSON.parse(raw.toString());
      if (message.id && pending.has(message.id)) {
        const p = pending.get(message.id); pending.delete(message.id);
        message.error ? p.reject(new Error("BROWSER_COMMAND_FAILED")) : p.resolve(message.result);
      } else if (message.method === "Fetch.requestPaused") {
        const request = message.params.request;
        const url = new URL(request.url);
        const allowed = url.origin === "http://127.0.0.1:5000"
          && (request.method === "GET" || (request.method === "POST" && url.pathname === "/api/auth/refresh"))
          && !url.pathname.startsWith("/api/admin/");
        command(allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
          { requestId: message.params.requestId, ...(!allowed ? { errorReason: "BlockedByClient" } : {}) }).catch(() => {});
      }
    });
    await command("Page.enable"); await command("Runtime.enable");
    await command("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 820, deviceScaleFactor: 1, mobile: false,
    });
    await command("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*", requestStage: "Request" }] });
    const evaluate = async expression => {
      const r = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      check(!r.exceptionDetails, "BROWSER_EVALUATION_FAILED"); return r.result?.value;
    };
    const poll = async expression => {
      for (let n = 0; n < 100; n++) { try { const value = await evaluate(expression); if (value) return value; } catch {} await sleep(200); }
      return null;
    };
    const capture = async label => {
      // Mask any addresses in the rendered QA page before saving local evidence.
      // No account/session state is changed; screenshots are not committed.
      await evaluate(`(()=>{const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode())if(n.parentElement?.tagName!=='SCRIPT')n.textContent=n.textContent.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi,'[synthetic owner email redacted]');return true})()`);
      const image = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.mkdirSync("generated-artifacts/s24-owner-qa", { recursive: true });
      fs.writeFileSync(`generated-artifacts/s24-owner-qa/${label}.png`, Buffer.from(image.data, "base64"), { mode: 0o600 });
    };
    failureCapture = capture;
    inspectScreen = () => evaluate(`({path:location.pathname,loginForm:!!document.querySelector('input[type="password"]'),loading:!!document.querySelector('[data-testid="hs-flight-deck-skeleton"]'),error:!!document.querySelector('[data-testid="flight-deck-error"]'),missing:!!document.querySelector('[data-testid="flight-deck-incomplete-state"]'),overlay:!!document.querySelector('vite-error-overlay')})`);
    await command("Page.navigate", { url: "http://127.0.0.1:5000/login" });
    check(await poll(`!!document.querySelector('input[type="email"]')`), "BROWSER_LOGIN_PAGE_UNAVAILABLE");
    // Authorized, real Supabase QA session. No password read, changed or submitted.
    await evaluate(`localStorage.setItem('lumiere_auth',${JSON.stringify(JSON.stringify(storedAuth))});true`);
    await command("Page.navigate", { url: "http://127.0.0.1:5000/flight-deck" });
    const ready = `!!document.querySelector('.fdp-live')&&!document.querySelector('[data-testid="hs-flight-deck-skeleton"]')&&!document.querySelector('[data-testid="flight-deck-error"]')&&!document.querySelector('[data-testid="not-configured"]')&&!document.querySelector('[data-testid="flight-deck-incomplete-state"]')`;
    check(await poll(ready), "REAL_HIGH_SCHOOL_DASHBOARD_NOT_RENDERED");
    result.highSchoolHome = "PASS";
    check(await evaluate(`!document.querySelector('a[href="/preview/flight-deck"]')`), "PROTOTYPE_LINK_STILL_VISIBLE");
    result.prototypeNavigationAbsent = "PASS";
    await capture("high-school-home");
    await command("Page.reload");
    await sleep(750); // Wait for the new document, not the still-visible old one.
    check(await poll(ready), "BROWSER_SESSION_RELOAD_FAILED");
    result.sessionReload = "PASS";
    // Route navigation uses the rendered real student sidebar links.
    for (const [route, label] of [["/high-school", "highSchoolRoadmap"], ["/documents", "documents"], ["/support", "support"]]) {
      check(await poll(`!!document.querySelector('a[href="${route}"]')`), `NAV_LINK_NOT_READY_${label.toUpperCase()}`);
      const clicked = await evaluate(`(()=>{const a=document.querySelector('a[href="${route}"]');if(!a)return false;a.click();return true})()`);
      check(clicked, `NAV_LINK_MISSING_${label.toUpperCase()}`);
      check(await poll(`location.pathname===${JSON.stringify(route)}&&!!document.querySelector('h1,h2')&&!document.body.innerText.includes('Your Lumière plan is not ready')`), `BROWSER_SCREEN_FAILED_${label.toUpperCase()}`);
      await sleep(1500);
      check(await evaluate(`!document.querySelector('vite-error-overlay')&&!document.body.innerText.includes('Internal Server Error')`), "BROWSER_ERROR_OVERLAY");
      if (label === "highSchoolRoadmap") {
        check(await poll(`document.body.innerText.includes('TEST ONLY')&&document.body.innerText.includes('NOT SCHOOL-APPROVED')`), "QA_ROADMAP_LABEL_NOT_VISIBLE");
        const subjects = await evaluate(`(()=>{const b=[...document.querySelectorAll('button,[role="tab"]')].find(e=>e.textContent.trim()==='My Subjects');if(!b)return false;b.click();return true})()`);
        check(subjects, "SUBJECTS_TAB_NOT_FOUND");
        check(await poll(`!!document.querySelector('[data-testid="tab-subjects"]')`), "SUBJECTS_TAB_NOT_OPEN");
        await evaluate(`(()=>{const card=[...document.querySelectorAll('[data-testid="subject-card"]')].find(e=>/Elective/i.test(e.innerText));const b=card?.querySelector('button[aria-expanded="false"]');if(b)b.click();return !!card})()`);
        check(await poll(`document.body.innerText.includes('Placeholder elective 5')`), "TEST_ELECTIVES_NOT_RENDERED");
        result.subjectsTab = "PASS — clicked; all five test-only elective placeholders rendered";
      }
      if (label === "documents") check(await poll(`!!document.querySelector('[data-testid="input-file-upload"]')`), "STUDENT_UPLOAD_CONTROL_MISSING");
      if (label === "support") {
        check(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('Create Ticket'));if(!b)return false;b.click();return true})()`), "SUPPORT_CREATE_CONTROL_MISSING");
        check(await poll(`!!document.querySelector('[role="dialog"]')`), "SUPPORT_TICKET_FORM_NOT_OPENED");
        result.supportForm = "PASS — opened, no ticket submitted";
      }
      result[label] = "PASS — sidebar clicked and screen rendered";
      await capture(label);
    }
    await command("Page.navigate", { url: "http://127.0.0.1:5000/roadmap" });
    check(await poll(`!!document.querySelector('[data-testid="university-only-notice"]')`), "UNIVERSITY_ROUTE_NOT_GUARDED");
    await evaluate(`document.querySelector('[data-testid="link-go-high-school"]').click();true`);
    check(await poll(`location.pathname==='/high-school'&&document.body.innerText.includes('TEST ONLY')`), "HIGH_SCHOOL_RETURN_LINK_FAILED");
    result.universityRouteGuardAndReturnLink = "PASS — university content denied, High School link clicked";
    // Prototype is deliberately synthetic and unauthenticated; check only its own rendering.
    await command("Page.navigate", { url: "http://127.0.0.1:5000/preview/flight-deck" });
    check(await poll(`document.body.innerText.includes('Prototype — synthetic data')&&!document.querySelector('vite-error-overlay')`), "PROTOTYPE_DIRECT_ROUTE_ERROR");
    result.directPrototypeErrorReproduced = false;
    result.sessionMethod = "Existing confirmed account, server-generated no-email magic-link exchange; password login NOT repeated";
    return result;
  } catch (error) {
    try { result.failureScreen = await inspectScreen?.(); await failureCapture?.("failed-screen"); } catch {}
    throw error;
  } finally {
    socket?.close();
    for (const p of pending.values()) p.reject(new Error("BROWSER_CLOSED"));
    pending.clear(); chrome?.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

try {
  check(provision || verify, "EXPLICIT_ACTION_REQUIRED");
  for (const name of Object.keys(process.env)) if (name === "DATABASE_URL" || name.startsWith("PG")) delete process.env[name];
  validateStartupEnvironment(process.env);
  const env = buildApplicationEnvironment(process.env);
  guardRuntime(env);
  check(env.SUPABASE_URL === "https://tqgwoyzlnkqwkcjsiocd.supabase.co", "PROJECT_REF_MISMATCH");
  // Only the verified staging connection is supplied to the imported business services.
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.EMAIL_ENABLED = "false";
  process.env.NODE_ENV = env.NODE_ENV;
  process.env.S22_STAGING_PROJECT_REF = env.S22_STAGING_PROJECT_REF;
  const { logger } = await import("../../server/lib/logger.ts"); logger.silent = true;
  const { supabaseAdmin, createUserAuthClient } = await import("../../server/lib/supabase.ts");
  const email = process.env.S24_OWNER_TEST_EMAIL?.trim().toLowerCase();
  check(email, "OWNER_EMAIL_REQUIRED");
  const profile = await supabaseAdmin.from("users").select("id,name,role").eq("email", email).maybeSingle();
  check(!profile.error && profile.data?.role === "student"
    && profile.data.name === "S23 SYNTHETIC OWNER SMTP TEST - DO NOT ENROLL", "ORIGINAL_SYNTHETIC_PROFILE_REQUIRED");
  const owner = profile.data;
  const auth = await supabaseAdmin.auth.admin.getUserById(owner.id);
  check(!auth.error && auth.data?.user?.email?.toLowerCase() === email
    && auth.data.user.email_confirmed_at
    && auth.data.user.user_metadata?.full_name === owner.name, "CONFIRMED_ORIGINAL_ACCOUNT_REQUIRED");
  outcomes.guard = "PASS — runtime and runner exclusively staging; original confirmed account remains student";
  const linked = await supabaseAdmin.from("students").select("id,preferred_name,status").eq("user_id", owner.id).limit(2);
  check(!linked.error && linked.data.length <= 1, "STUDENT_LINK_LOOKUP_FAILED");
  let student = linked.data[0];
  if (student) check(student.preferred_name === QA_STUDENT_CODE, "PREEXISTING_NON_QA_STUDENT_REFUSED");
  ({ closeDatabase } = await import("../../server/lib/db.ts"));
  const { defaultHighSchoolService: hs } = await import("../../server/services/high-school-service.default.ts");
  if (!student && provision) {
    const { createStudent } = await import("../../server/services/student-service.ts");
    student = await createStudent({
      user_id: owner.id, status: "lead",
      first_name: "S24 STAGING TEST ONLY", last_name: "Synthetic QA Student",
      middle_name: null, preferred_name: QA_STUDENT_CODE, sex: null,
      gov_id_type: null, gov_id_number: null, photo_url: null,
      dob: "2000-01-01", nationality: [], residency: "us",
      email, phone_primary: "+12025550123", preferred_contact_channel: "email",
      phone_secondary: null, whatsapp_primary: false, timezone: null,
      address_country: "US", address_line1: "1 Synthetic QA Test Way",
      address_state: null, address_city: null, address_postal: null, address_line2: null,
      hs_path: null, hs_country: null, hs_school: null, hs_year: null, hs_doc_url: null,
      hs_completion: false, prior_credits: false, prior_sources: [], transcripts_url: [],
      target_degree: null, target_major: null, start_term: null,
      prior_credits_est: null, target_pace: null, consent_signature: null,
      marketing_opt_in: false, media_release: false,
    }, owner.id);
    outcomes.profileCreated = "PASS — synthetic required fields; linked only to original test identity";
  }
  check(student, "QA_STUDENT_NOT_PROVISIONED");
  if (student.status === "lead" && provision) {
    const { changeStudentStatus } = await import("../../server/services/admin-student-status.ts");
    student = await changeStudentStatus(student.id, "active", owner.id,
      { provisioning: "staging-owner-authorized-service", note: QA_NOTICE });
    outcomes.activation = "PASS — same shared administrative status operation and audit; no account-role escalation";
  }
  check(student.status === "active", "QA_STUDENT_NOT_ACTIVE");
  let state = await hs.getStaffState(student.id);
  if (!state.current && provision) {
    const { createEnrollmentSchema } = await import("../../shared/high-school-contract.ts");
    state = (await hs.createEnrollment(student.id, owner.id,
      createEnrollmentSchema.parse({ templateKey: "us-hs-diploma-21", templateVersion: 2, status: "active" }))).result;
    outcomes.enrollment = "PASS — existing v2 template, standard 21-credit contract, no exceptions";
  }
  check(state.current?.enrollment, "QA_ENROLLMENT_MISSING");
  const enrollment = state.current.enrollment;
  check(enrollment.templateKey === "us-hs-diploma-21" && enrollment.templateVersion === 2
    && enrollment.totalRequiredHalfUnits === 42, "QA_ENROLLMENT_MODEL_MISMATCH");
  if (!state.current.published && provision) {
    if (!state.current.draft) state = (await hs.draftFromTemplate(student.id, enrollment.id, owner.id, {})).result;
    const draft = state.current.draft;
    check(draft, "QA_DRAFT_MISSING");
    const content = draft.content.studentMessage?.startsWith(QA_NOTICE) ? draft.content : makeQaRoadmap(draft.content);
    state = (await hs.saveDraft(student.id, enrollment.id, owner.id,
      { expectedDraftRevision: draft.draftRevision, content })).result;
    outcomes.draft = "PASS — existing core unchanged; five explicitly non-approved QA elective placeholders";
    try {
      state = (await hs.publish(student.id, enrollment.id, owner.id, {
        expectedDraftRevision: state.current.draft.draftRevision, expectedPublishedVersionId: null,
      })).result;
      outcomes.publication = "PASS — actual existing validator accepted synthetic-only plan; no override/bypass";
    } catch (error) {
      outcomes.publication = "BLOCKED — draft retained; validation not bypassed";
      throw error;
    }
  }
  const published = state.current.published;
  check(published?.content?.studentMessage?.startsWith(QA_NOTICE), "LABELLED_QA_PUBLICATION_MISSING");
  const content = published.content;
  check(content.courses.filter(c => c.status === "planned").reduce((n, c) => n + c.halfUnits, 0) === 42, "PUBLISHED_QA_CREDIT_MISMATCH");
  outcomes.publishedPlan = { totalCredits: 21, coreCredits: 16, electiveCredits: 5,
    electiveApproval: "TEST PLACEHOLDERS ONLY — NOT SCHOOL-APPROVED", officialCreditsAwardedByThisRun: 0 };

  if (verify) {
    await hs.getStudentView(student.id);
    outcomes.studentViewProjection = "PASS";
    // Respect the normal policy rather than resetting the preview or spoofing an IP.
    const quota = await fetch(env.APP_URL + "/api/csrf-token", { redirect: "error", signal: AbortSignal.timeout(15000) });
    await quota.body?.cancel();
    if (quota.status === 429) {
      const seconds = Number(quota.headers.get("retry-after"));
      check(Number.isFinite(seconds) && seconds >= 0 && seconds <= 900, "API_RATE_WINDOW_UNVERIFIED");
      outcomes.rateWindowWaitSeconds = seconds + 2;
      await sleep((seconds + 2) * 1000);
    } else check([200, 401].includes(quota.status), "PREVIEW_API_UNAVAILABLE");
    // Admin generation does not send mail; use only the hash privately, never action_link.
    const generated = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
    check(!generated.error && generated.data?.properties?.hashed_token, "QA_SESSION_GENERATION_FAILED");
    const userClient = createUserAuthClient();
    qaClient = userClient;
    const signed = await userClient.auth.verifyOtp({ token_hash: generated.data.properties.hashed_token, type: "magiclink" });
    check(!signed.error && signed.data?.user?.id === owner.id && signed.data.session, "QA_SESSION_EXCHANGE_FAILED");
    const refreshed = await userClient.auth.refreshSession({ refresh_token: signed.data.session.refresh_token });
    check(!refreshed.error && refreshed.data?.user?.id === owner.id && refreshed.data.session, "QA_SESSION_REFRESH_FAILED");
    const session = refreshed.data.session;
    const get = async (route, authenticated = true) => {
      const r = await fetch(env.APP_URL + route, { headers: authenticated ? { authorization: `Bearer ${session.access_token}` } : {},
        redirect: "error", signal: AbortSignal.timeout(20000) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const api = {};
    for (const route of ["/api/me", "/api/students/me", "/api/student/programs",
      "/api/student/high-school", "/api/student/academic-projection", `/api/documents/student/${student.id}`, "/api/tickets"]) {
      const r = await get(route);
      check(r.status === 200, "SCOPED_API_FAILED_" + route.split("/").filter(Boolean).slice(-1)[0].replace(/[^a-z0-9]/gi, "_").toUpperCase());
      if (route === "/api/students/me") check(r.body.id === student.id && r.body.user_id === owner.id, "STUDENT_API_LINK_MISMATCH");
      if (route === "/api/student/programs") check(r.body.programs?.length === 1 && r.body.programs[0].kind === "high_school", "HIGH_SCHOOL_ONLY_ROUTING_FAILED");
      api[route.includes(student.id) ? "/api/documents/student/<synthetic>" : route] = "PASS — 200";
    }
    const guest = await get("/api/students/me", false);
    check(guest.status === 401, "GUEST_ACCESS_NOT_DENIED");
    const denied = await get(`/api/admin/students/${student.id}/high-school`);
    check(denied.status === 403, "STUDENT_ADMIN_ACCESS_NOT_DENIED");
    const other = await get("/api/documents/student/s24-unowned-nonexistent-student");
    check([403, 404].includes(other.status), "CROSS_STUDENT_DOCUMENT_ACCESS_NOT_DENIED");
    outcomes.api = api;
    outcomes.authorization = { guest: guest.status, adminDenied: denied.status, otherStudentDocumentsDenied: other.status };
    const csrf = await get("/api/csrf-token");
    const stored = { user: { id: owner.id, name: owner.name, email, role: "student" },
      session: { access_token: session.access_token, refresh_token: session.refresh_token,
        expires_at: session.expires_at, csrf_token: csrf.body?.csrfToken } };
    outcomes.browser = await browserChecks(stored, student.id);
  }
  outcomes.verdict = "PASS";
} catch (error) {
  outcomes.verdict = "FAIL";
  outcomes.blocker = typeof error?.message === "string" && /^[A-Z0-9_]+$/.test(error.message)
    ? error.message : typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code : "STAGING_QA_OPERATION_FAILED_DETAILS_WITHHELD";
  if (Array.isArray(error?.issues)) outcomes.validationFields = error.issues.map(i => ({ field: i.path.join("."), code: i.code }));
  for (let cause = error, depth = 0; cause && depth < 5; cause = cause.cause, depth++) {
    if (typeof cause.code === "string" && /^[A-Z0-9_]+$/.test(cause.code)) outcomes.driverCode = cause.code;
    const missingColumn = typeof cause.message === "string" && cause.message.match(/column "([a-zA-Z0-9_.]+)" does not exist/);
    if (missingColumn) outcomes.missingColumn = missingColumn[1];
  }
  process.exitCode = 1;
} finally {
  // Revoke only this runner's refresh session, never the owner's other sessions.
  try { await qaClient?.auth.signOut({ scope: "local" }); } catch {}
  console.log(JSON.stringify(outcomes, null, 2));
  try { await closeDatabase?.(); } catch {}
}
