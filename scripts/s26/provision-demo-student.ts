/**
 * S26 — provision the SYNTHETIC first-student demonstration through the application's own services.
 *
 *   npx tsx scripts/s26/provision-demo-student.ts --ref <supabase-project-ref>
 *
 * Owner-authorized for production (docs/recovery/S26-ADDENDUM-DIRECT-PRODUCTION-AUTHORIZATION.md).
 * Idempotent: re-running reuses the existing demo accounts/records and only fills what is missing.
 * Creates: DEMO student login (role student, .invalid email, no mail sent), a second DEMO student
 * (no login, used only for cross-student refusal checks), a synthetic guardian (authority NOT
 * verified), synthetic prior schooling (reported), an active v2 enrollment and the published
 * 21-credit / 12-month demonstration roadmap with 0 official credit. Never records a result,
 * award, payment, consent, school reference or diploma.
 *
 * The demo student's password is taken from S26_DEMO_STUDENT_PASSWORD, or generated and written
 * ONLY to .s26-private-backup/demo-student-login.txt (git-ignored, mode 600). Never printed.
 * Output: one JSON summary line set with ids (no secrets).
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { DEMO_TAG, DEMO_START, DEMO_TARGET, makeDemoPlan, makeContractPlan } from "./demo-plan.mjs";

export const DEMO_STUDENT_EMAIL = "s26.demo.student@lumiere-demo.invalid";
export const DEMO_SECOND_EMAIL = "s26.demo.second@lumiere-demo.invalid";
export const DEMO_PREFERRED = "DEMO-S26-FR";
export const DEMO_SECOND_PREFERRED = "DEMO-S26-SECOND";

const out: Record<string, unknown> = {};
const check = (ok: unknown, code: string) => { if (!ok) throw new Error(code); };

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

async function main() {
  const ref = arg("--ref");
  check(ref && /^[a-z0-9]{20}$/.test(ref), "REF_REQUIRED");
  check(process.env.SUPABASE_URL === `https://${ref}.supabase.co`, "SUPABASE_URL_REF_MISMATCH");
  check(process.env.DATABASE_URL?.includes(ref!), "DATABASE_URL_REF_MISMATCH");
  process.env.EMAIL_ENABLED = "false";
  const { logger } = await import("../../server/lib/logger");
  (logger as unknown as { silent: boolean }).silent = true;
  const { supabaseAdmin } = await import("../../server/lib/supabase");
  const { closeDatabase } = await import("../../server/lib/db");
  try {
    // Actor: the earliest active administrator (the owner). Provisioning is attributed to it and
    // tagged in metadata; no role, password or session of that account is touched.
    const admins = await supabaseAdmin.from("users").select("id,role,created_at").eq("role", "admin").order("created_at", { ascending: true }).limit(1);
    check(!admins.error && admins.data?.[0], "NO_ADMIN_ACTOR");
    const actorId: string = admins.data![0].id;

    const ensureUser = async (email: string, name: string, password: string | null) => {
      const existing = await supabaseAdmin.from("users").select("id,role,name").eq("email", email).maybeSingle();
      check(!existing.error, "USER_LOOKUP_FAILED");
      if (existing.data) {
        check(existing.data.role === "student" && String(existing.data.name).startsWith("DEMO"), "PREEXISTING_NON_DEMO_USER_REFUSED");
        if (password) {
          const upd = await supabaseAdmin.auth.admin.updateUserById(existing.data.id, { password });
          check(!upd.error, "DEMO_PASSWORD_UPDATE_FAILED");
        }
        return existing.data.id as string;
      }
      const created = await supabaseAdmin.auth.admin.createUser({
        email, email_confirm: true, user_metadata: { full_name: name, synthetic_demo: true },
        ...(password ? { password } : {}),
      });
      check(!created.error && created.data.user, "DEMO_AUTH_CREATE_FAILED");
      const id = created.data.user!.id;
      const row = await supabaseAdmin.from("users").upsert({ id, email, name, role: "student" }, { onConflict: "id" });
      check(!row.error, "DEMO_USER_ROW_FAILED");
      await supabaseAdmin.from("profiles").upsert({ user_id: id, status: "active" }, { onConflict: "user_id", ignoreDuplicates: true });
      return id;
    };

    let password = process.env.S26_DEMO_STUDENT_PASSWORD?.trim() || null;
    const credFile = ".s26-private-backup/demo-student-login.txt";
    if (!password && !fs.existsSync(credFile)) password = `Demo-${crypto.randomBytes(9).toString("base64url")}-26`;
    if (password) {
      fs.mkdirSync(".s26-private-backup", { recursive: true });
      fs.writeFileSync(credFile, `DEMO student login (synthetic, not a real student)\nemail: ${DEMO_STUDENT_EMAIL}\npassword: ${password}\n`, { mode: 0o600 });
    }
    const userId = await ensureUser(DEMO_STUDENT_EMAIL, `DEMO Élève Synthétique — ${DEMO_TAG}`, password);
    const secondUserId = await ensureUser(DEMO_SECOND_EMAIL, `DEMO Second Synthetic Student — ${DEMO_TAG}`, null);
    out.accounts = { demoStudentUser: userId, secondDemoUser: secondUserId, credentialFile: password ? credFile : "unchanged" };

    const { createStudent, getStudentByUserId, getStudentContacts, addStudentContact } = await import("../../server/services/student-service");
    const { changeStudentStatus } = await import("../../server/services/admin-student-status");
    const base = {
      status: "lead", middle_name: null, sex: null, gov_id_type: null, gov_id_number: null, photo_url: null,
      nationality: ["MA"], residency: "foreign", phone_primary: "+212600000000", preferred_contact_channel: "email",
      phone_secondary: null, whatsapp_primary: false, timezone: "Africa/Casablanca",
      address_country: "MA", address_line1: "DEMO — fictional address, not real", address_state: null,
      address_city: "Casablanca (DEMO)", address_postal: null, address_line2: null,
      hs_path: null, hs_country: "MA", hs_school: null, hs_year: null, hs_doc_url: null,
      hs_completion: false, prior_credits: false, prior_sources: [], transcripts_url: [],
      target_degree: null, target_major: null, start_term: null, prior_credits_est: null, target_pace: null,
      consent_signature: null, marketing_opt_in: false, media_release: false,
    };
    const ensureStudent = async (uid: string, fields: Record<string, unknown>) => {
      let s = await getStudentByUserId(uid);
      if (s) check(String(s.preferred_name).startsWith("DEMO-S26"), "PREEXISTING_NON_DEMO_STUDENT_REFUSED");
      if (!s) s = await createStudent({ ...base, ...fields, user_id: uid } as never, actorId);
      if (s.status === "lead") s = await changeStudentStatus(s.id, "active", actorId, { provisioning: "s26-demo-fixture", note: DEMO_TAG }) as typeof s;
      return s;
    };
    const student = await ensureStudent(userId, {
      first_name: "DEMO Élève", last_name: "Synthétique (NOT A REAL STUDENT)", preferred_name: DEMO_PREFERRED,
      dob: "2010-01-01", email: DEMO_STUDENT_EMAIL,
    });
    const second = await ensureStudent(secondUserId, {
      first_name: "DEMO Second", last_name: "Synthetic (NOT A REAL STUDENT)", preferred_name: DEMO_SECOND_PREFERRED,
      dob: "2010-01-01", email: DEMO_SECOND_EMAIL,
    });
    out.students = { demo: { id: student.id, code: student.student_code }, second: { id: second.id, code: second.student_code } };

    // Non-critical steps are reported individually and never stop the academic provisioning.
    const warnings: Record<string, string> = {};
    out.warnings = warnings;
    const soft = async (name: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (e) { warnings[name] = String((e as Error)?.message ?? e).slice(0, 200); }
    };
    // French preference (the student's own saved portal language).
    await soft("language", async () => {
      const { pgLanguagePreferenceStore } = await import("../../server/routes/student-preferences");
      await pgLanguagePreferenceStore.set(userId, "fr", new Date());
    });

    // Synthetic guardian: listed, NOT verified, no consent document.
    await soft("guardian", async () => {
    const contacts = await getStudentContacts(student.id);
    if (!contacts.some((c) => c.full_name.startsWith("DEMO"))) {
      await addStudentContact(student.id, {
        type: "guardian", full_name: "DEMO Tuteur Synthétique (fictional guardian)", relationship: "Guardian (DEMO)",
        phone: "+212600000001", email: "s26.demo.guardian@lumiere-demo.invalid", language: "fr", scopes: [],
        consent_doc_url: null, authority_status: "listed",
      } as never, actorId);
    }
    });

    const { defaultHighSchoolService: hs } = await import("../../server/services/high-school-service.default");
    const { createEnrollmentSchema, recordPriorEducationSchema } = await import("../../shared/high-school-contract");
    let state = await hs.getStaffState(student.id);
    if (!state.current) {
      state = (await hs.createEnrollment(student.id, actorId, createEnrollmentSchema.parse({
        templateKey: "us-hs-diploma-21", templateVersion: 2, status: "active", startedOn: DEMO_START, targetCompletionDate: DEMO_TARGET,
      }))).result;
    }
    const enrollment = state.current!.enrollment;
    check(enrollment.templateVersion === 2 && enrollment.totalRequiredHalfUnits === 42, "DEMO_ENROLLMENT_MODEL_MISMATCH");
    if (state.current!.priorEducation.length === 0) await soft("priorEducation", async () => {
      state = (await hs.recordPriorEducation(student.id, enrollment.id, actorId, recordPriorEducationSchema.parse({
        schoolName: "DEMO — fictional Moroccan collège (synthetic)", country: "Morocco", gradeLevels: "DEMO 3e année collège",
        status: "reported", staffNote: `${DEMO_TAG}. Evidence not requested; no transfer credit claimed.`,
      }))).result;
    });
    const published = state.current!.published;
    if (!published?.content?.studentMessage?.startsWith(DEMO_TAG)) {
      if (!state.current!.draft) state = (await hs.draftFromTemplate(student.id, enrollment.id, actorId, undefined)).result;
      const draft = state.current!.draft!;
      const content = draft.content.studentMessage?.startsWith(DEMO_TAG) ? draft.content : makeDemoPlan(draft.content);
      state = (await hs.saveDraft(student.id, enrollment.id, actorId, { expectedDraftRevision: draft.draftRevision, content })).result;
      state = (await hs.publish(student.id, enrollment.id, actorId, {
        expectedDraftRevision: state.current!.draft!.draftRevision, expectedPublishedVersionId: published?.versionId ?? null,
      })).result;
    }
    const plan = state.current!.published!.content;
    const plannedHalf = plan.courses.filter((c) => c.status === "planned").reduce((n, c) => n + c.halfUnits, 0);
    check(plannedHalf === 42 && plan.courses.length === 22, "DEMO_PUBLISHED_PLAN_MISMATCH");
    check(state.current!.awards.length === 0 && state.current!.results.length === 0, "DEMO_HAS_OFFICIAL_RESULTS");
    out.plan = {
      enrollmentId: enrollment.id, courses: plan.courses.length, coreCourses: 17, electiveCandidates: 5,
      plannedCredits: plannedHalf / 2, officialCreditsEarned: state.current!.credits.earnedHalfUnits / 2,
      milestones: plan.pacing.milestones.length, tasks: plan.courses.reduce((n, c) => n + c.tasks.length, 0),
    };

    // Synthetic DEMO portraits (generated artwork, clearly labelled; never a real person). Same bucket,
    // path shape and stored reference as POST /api/students/:id/photo. Only set when no photo exists.
    await soft("demoPhotos", async () => {
      const { updateStudent } = await import("../../server/services/student-service");
      for (const [st, file] of [[student, "demo-avatar.jpg"], [second, "demo-avatar-second.jpg"]] as const) {
        if (st.photo_url) continue;
        const path = `profile-photos/${st.id}_${crypto.randomUUID()}.jpg`;
        const up = await supabaseAdmin.storage.from("student-documents").upload(path, fs.readFileSync(`scripts/s26/assets/${file}`), { contentType: "image/jpeg", upsert: false });
        if (up.error) throw new Error(`photo upload: ${up.error.message}`);
        await updateStudent(st.id, { photo_url: `storage:student-documents/${path}` } as never, actorId);
      }
    });

    // Representative SYNTHETIC billing for the demo student only (never the real student): agreed price,
    // one documented adjustment and one partial payment, so the staff and student billing views have
    // real ledger rows. Payment processing does not exist; these are records of external events.
    await soft("demoBilling", async () => {
      const { defaultBillingService: billing } = await import("../../server/services/billing-service.default");
      const view = await billing.getStaffView(student.id);
      if (view.student.state === "configured") return;
      await billing.setObligation(student.id, actorId, { agreedCents: 400000, currency: "USD", note: `${DEMO_TAG} — synthetic agreed price for QA` });
      await billing.addDiscount(student.id, actorId, { amountCents: 25000, reason: `${DEMO_TAG} — synthetic approved adjustment` });
      await billing.setInstallments(student.id, actorId, { installments: [
        { dueDate: "2026-11-02", amountCents: 200000, label: "DEMO installment 1" },
        { dueDate: "2027-01-04", amountCents: 175000, label: "DEMO installment 2" },
      ] });
      await billing.recordReceipt(student.id, actorId, { amountCents: 200000, receivedDate: "2026-10-29", methodLabel: "DEMO bank transfer (synthetic)", reference: "DEMO-S26-0001", note: `${DEMO_TAG} — not a real payment` });
    });

    // REAL first student (pre-enrollment record created by the owner; S26 contract override):
    // prepare the contract-aligned DRAFT only. No identity/contact change, no publish, no dates,
    // no activation, no invitation. Skipped when --real-code is not given.
    const realCode = arg("--real-code");
    if (realCode) {
      const { getStudentByCode } = await import("../../server/services/student-service");
      const real = await getStudentByCode(realCode);
      check(real && !String(real.preferred_name ?? "").startsWith("DEMO"), "REAL_STUDENT_NOT_FOUND");
      let rs = await hs.getStaffState(real!.id);
      if (!rs.current) {
        rs = (await hs.createEnrollment(real!.id, actorId, createEnrollmentSchema.parse({
          templateKey: "us-hs-diploma-21", templateVersion: 2, status: "planned",
        }))).result;
      }
      const re = rs.current!.enrollment;
      if (!rs.current!.published) {
        if (!rs.current!.draft) rs = (await hs.draftFromTemplate(real!.id, re.id, actorId, undefined)).result;
        const d = rs.current!.draft!;
        if (!d.content.studentMessage?.startsWith("Plan indicatif")) {
          rs = (await hs.saveDraft(real!.id, re.id, actorId, { expectedDraftRevision: d.draftRevision, content: makeContractPlan(d.content) })).result;
        }
      }
      const dc = rs.current!.draft?.content;
      out.realStudent = {
        code: realCode, enrollmentStatus: re.status, published: !!rs.current!.published,
        draftCourses: dc?.courses.length ?? null, draftPlannedCredits: dc ? dc.courses.reduce((n, c) => n + c.halfUnits, 0) / 2 : null,
        officialCreditsEarned: rs.current!.credits.earnedHalfUnits / 2, studentStatus: real!.status, portalLinked: !!real!.user_id,
      };
    }
    // DEMO cohort (owner order S26-PREMIUM-UX…): synthetic personas, tickets, documents, billing and the
    // DEMO MIRROR of the first student's scenario. Failures are reported per persona/step, never fatal.
    try {
      const { provisionDemoCohort } = await import("./demo-cohort");
      out.demoCohort = await provisionDemoCohort({ actorId, supabaseAdmin, warnings }, arg("--real-code"));
    } catch (e) {
      warnings.demoCohort = String((e as Error)?.message ?? e).slice(0, 200);
    }

    // Confidential first-student intake (portrait, contract PDF, proposed billing): only when the owner has
    // placed the private handoff in the git-ignored s26-private-intake/ folder. Runs through the live app's
    // authenticated APIs; its evidence (s26-evidence/intake.json) holds field names and statuses only.
    if (fs.existsSync("s26-private-intake")) {
      const { spawnSync } = await import("node:child_process");
      const r = spawnSync("npx", ["tsx", "scripts/s26/private-intake.ts", "--base", "https://lumiere-student-portal-v-2.replit.app", "--ref", ref!], { stdio: "ignore", timeout: 15 * 60_000 });
      out.privateIntake = r.status === 0 ? "PASS (see s26-evidence/intake.json)" : `FAIL exit ${r.status} (see s26-evidence/intake.json)`;
    } else {
      out.privateIntake = "PENDING — no s26-private-intake/ folder in the production workspace";
    }
    out.verdict = "PASS";
  } finally {
    await closeDatabase?.().catch(() => {});
  }
}

main().catch((error) => {
  out.verdict = "FAIL";
  out.blocker = typeof error?.message === "string" && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "PROVISIONING_FAILED";
  if (Array.isArray(error?.issues)) out.validation = error.issues.map((i: { path: unknown[]; code: string }) => ({ field: i.path.join("."), code: i.code }));
  if (!/^[A-Z0-9_]+$/.test(String(error?.message))) out.detail = String(error?.message ?? error).slice(0, 300);
  process.exitCode = 1;
}).finally(() => console.log(JSON.stringify(out, null, 2)));
