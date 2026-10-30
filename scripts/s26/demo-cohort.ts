/**
 * S26 — the DEMO cohort: six synthetic student stories (plus the existing DEMO-S26-FR / DEMO-S26-SECOND)
 * and the DEMO MIRROR of the first real student's scenario, so the owner can explore a populated portal.
 *
 * Owner-authorized (docs/recovery/S26-PREMIUM-UX-POPULATED-DEMO-CONTEXTUAL-AI-EXECUTION.md). Every row is
 * unmistakably synthetic: "DEMO" names, .invalid emails, "DEMO" document/ticket titles, synthetic flags in
 * metadata. Idempotent: each persona and each ticket is created once (keyed by preferred_name and a
 * metadata.demo_seed key). Official results recorded here exist ONLY on synthetic students and cite a
 * synthetic "DEMO school result report" document. Nothing touches the real student's record; the mirror is
 * a separate synthetic account. No email is sent (EMAIL_ENABLED=false in the provisioning process and no
 * notifier is called: rows are written through services and the tables the support desk reads).
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { DEMO_TAG, makeDemoPlan, makeContractPlan } from "./demo-plan.mjs";
import { BACHELORS_KEY, DEMO_BACHELORS_GOAL, seedBachelorsDegree } from "./demo-bachelors";
import type { DemoGoal } from "./demo-bachelors";

type Ctx = { actorId: string; supabaseAdmin: any; warnings: Record<string, string> };
const DOMAIN = "lumiere-demo.invalid";

export interface Persona {
  key: string;               // preferred_name marker
  first: string; last: string;
  email: string;
  story: string;
  start?: string;            // plan start (demo plan); undefined = no enrollment (prospect)
  contract?: boolean;        // contract-aligned 16-week plan (mirror)
  officialMonths?: number;   // months of courses recorded as officially completed (synthetic)
  progressCourses?: string[];// course keys with student-reported progress
  billing?: { agreed: number; discount?: number; installments?: Array<[string, number]>; receipts?: Array<[string, number, string]>; voidFirstReceipt?: boolean };
  /** S27 (synthetic): agreement dates are offsets in days from today (negative = past). */
  program?: { signedDaysAgo: number; activatedDaysAgo?: number; languageTestDone?: boolean; goal?: boolean | DemoGoal };
  /** S27: a DEGREE (bachelor's) student: fictional degree program, canonical prior credit and a published degree
   *  roadmap (scripts/s26/demo-bachelors.ts) instead of a high-school enrollment. Never billing. */
  degree?: boolean;
  /** Student-row overrides (e.g. an adult's date of birth, completed high school). */
  profile?: Record<string, unknown>;
  /** False: no synthetic guardian (adult student). */
  guardian?: boolean;
  checkpointsDone?: string[];
  sessionRequest?: boolean;
  notes?: string[];
  /** S27: a student-submitted payment proof awaiting staff review. */
  evidencePending?: boolean;
  documents?: Array<{ type: string; name: string; state: "verified" | "pending" | "resubmit_requested" | "rejected"; message?: string }>;
  tickets?: Array<{ seed: string; subject: string; topic: string; category: string; priority: string; status: string; messages: Array<{ by: "student" | "staff"; internal?: boolean; text: string; daysAgo: number }> }>;
}

export const PERSONAS: Persona[] = [
  {
    key: "DEMO-S26-P3", first: "DEMO Amira", last: "Mid-program (synthetic)", email: `s26.p3@${DOMAIN}`,
    story: "Mid-program: 9 credits officially confirmed, two courses in progress, installment plan.",
    start: "2026-04-06", officialMonths: 5, progressCourses: ["science-biology", "math-general-2"],
    program: { signedDaysAgo: 200, activatedDaysAgo: 190, languageTestDone: true, goal: true }, checkpointsDone: ["file_opened", "program_activated", "kickoff_call"],
    notes: ["DEMO internal: steady pace; midpoint check due next month."],
    billing: { agreed: 400000, installments: [["2026-04-06", 100000], ["2026-06-01", 100000], ["2026-08-03", 100000], ["2026-11-02", 100000]], receipts: [["2026-04-06", 100000, "DEMO-P3-1"], ["2026-06-02", 100000, "DEMO-P3-2"], ["2026-08-04", 100000, "DEMO-P3-3"]] },
    documents: [{ type: "hs_transcript", name: "DEMO-prior-school-report.pdf", state: "verified" }, { type: "id_gov", name: "DEMO-id.pdf", state: "verified" }],
    tickets: [
      { seed: "p3-t1", subject: "DEMO — Biology lab assignment format", topic: "course_assistance", category: "academic", priority: "medium", status: "resolved", messages: [
        { by: "student", text: "DEMO: How should I format the Biology lab report — is a template provided?", daysAgo: 9 },
        { by: "staff", text: "DEMO: Use the template in the course's resources in the school platform; Lumière's study guide in your Library has a checklist.", daysAgo: 8 },
        { by: "staff", internal: true, text: "DEMO internal: student on track, no follow-up needed.", daysAgo: 8 },
        { by: "student", text: "DEMO: Found it, thank you!", daysAgo: 7 }] },
    ],
  },
  {
    key: "DEMO-S26-P4", first: "DEMO Yanis", last: "At-risk (synthetic)", email: `s26.p4@${DOMAIN}`,
    story: "At risk: behind the monthly plan, overdue tasks, a document to re-upload, an unresolved ticket.",
    start: "2026-06-01", officialMonths: 1, progressCourses: ["english-1"],
    program: { signedDaysAgo: 150, activatedDaysAgo: 140 }, checkpointsDone: ["file_opened", "program_activated"], sessionRequest: true,
    notes: ["DEMO internal: behind plan; language test deadline passed, follow up."],
    billing: { agreed: 400000, installments: [["2026-06-01", 200000], ["2026-09-01", 200000]], receipts: [["2026-06-02", 200000, "DEMO-P4-1"]] },
    documents: [{ type: "id_gov", name: "DEMO-passport-scan.pdf", state: "resubmit_requested", message: "DEMO: The photo page is blurry. Please upload a clearer scan." }],
    tickets: [
      { seed: "p4-t1", subject: "DEMO — Stuck on the English 1 project", topic: "course_assistance", category: "academic", priority: "high", status: "open", messages: [
        { by: "student", text: "DEMO: I don't understand what the English 1 project asks for and I'm behind.", daysAgo: 3 }] },
      { seed: "p4-t2", subject: "DEMO — Missed milestone follow-up", topic: "roadmap_question", category: "academic", priority: "medium", status: "waiting_on_student", messages: [
        { by: "staff", text: "DEMO: We noticed you are behind the September milestone. Can we schedule a short call to rebuild your weekly plan?", daysAgo: 5 },
        { by: "staff", internal: true, text: "DEMO internal: tutor follow-up planned; check again Friday.", daysAgo: 5 }] },
    ],
  },
  {
    key: "DEMO-S26-P5", first: "DEMO Lina", last: "Elective change (synthetic)", email: `s26.p5@${DOMAIN}`,
    story: "Elective substitution: request reviewed by Lumière, waiting for the school's decision.",
    start: "2026-09-07", officialMonths: 0, progressCourses: ["startup-personal-growth"],
    program: { signedDaysAgo: 50, activatedDaysAgo: 45 }, checkpointsDone: ["file_opened", "program_activated"],
    billing: { agreed: 400000, installments: [["2026-09-07", 400000]], receipts: [["2026-09-07", 400000, "DEMO-P5-1"]] },
    tickets: [
      { seed: "p5-t1", subject: "Elective change request: Reading Skills → Psychology", topic: "roadmap_question", category: "academic", priority: "medium", status: "in_progress", messages: [
        { by: "student", text: "DEMO request.\nCurrent course: Reading Skills (key: elective-reading-skills)\nRequested alternate: Psychology\nReason: I want to study communication and psychology is closer to it.\nStatus: REQUESTED — awaiting Lumière review, then school approval. The roadmap changes only after approval (new roadmap version).", daysAgo: 6 },
        { by: "staff", internal: true, text: "[ELECTIVE-STAGE] lumiere_review\nDEMO: reasonable request; checking availability.", daysAgo: 5 },
        { by: "staff", internal: true, text: "[ELECTIVE-STAGE] school_pending\nDEMO: substitute submitted to the school for acceptance.", daysAgo: 2 },
        { by: "staff", text: "DEMO: Thanks — we asked the school whether Psychology can replace Art Appreciation. Your roadmap stays the same until they answer.", daysAgo: 2 }] },
    ],
  },
  {
    key: "DEMO-S26-P6", first: "DEMO Omar", last: "Near completion (synthetic)", email: `s26.p6@${DOMAIN}`,
    story: "Near completion: 20 credits officially confirmed, last elective in progress, transcript questions.",
    start: "2025-11-03", officialMonths: 11, progressCourses: ["elective-reading-skills"],
    billing: { agreed: 400000, installments: [["2025-11-03", 400000]], receipts: [["2025-11-03", 400000, "DEMO-P6-1"]] },
    documents: [{ type: "hs_transcript", name: "DEMO-school-progress-report.pdf", state: "verified" }],
    tickets: [
      { seed: "p6-t1", subject: "DEMO — When will I receive my transcript?", topic: "transcript_document", category: "document", priority: "medium", status: "waiting_on_student", messages: [
        { by: "student", text: "DEMO: After my last course, how do I get my official transcript and diploma?", daysAgo: 4 },
        { by: "staff", text: "DEMO: Once the school records your final result and confirms eligibility, it issues the transcript and diploma. Please confirm the postal address for the diploma.", daysAgo: 3 }] },
    ],
  },
  {
    key: "DEMO-S26-P7", first: "DEMO Sofia", last: "Billing scenario (synthetic)", email: `s26.p7@${DOMAIN}`,
    story: "Billing: installments, a corrected (voided) receipt, an approved adjustment and a payment-proof question.",
    start: "2026-08-03", officialMonths: 1,
    billing: { agreed: 400000, discount: 30000, installments: [["2026-08-03", 120000], ["2026-10-01", 125000], ["2026-12-01", 125000]], receipts: [["2026-08-04", 125000, "DEMO-P7-WRONG"], ["2026-08-04", 120000, "DEMO-P7-1"]], voidFirstReceipt: true },
    tickets: [
      { seed: "p7-t1", subject: "DEMO — Payment record clarification", topic: "billing", category: "billing", priority: "medium", status: "waiting_on_student", messages: [
        { by: "student", text: "DEMO: My October installment shows as due but my parents sent it. What should I do?", daysAgo: 2 },
        { by: "staff", text: "DEMO: Please upload the transfer confirmation in Billing; we confirm payments only from the bank record.", daysAgo: 1 },
        { by: "staff", internal: true, text: "DEMO internal: no transfer seen on the bank statement yet.", daysAgo: 1 }] },
    ],
  },
  {
    key: "DEMO-S27-P8", first: "DEMO Karim", last: "Installment plan (synthetic)", email: `s27.p8@${DOMAIN}`,
    story: "Installment plan: 4 installments, 2 paid with receipts, a student payment proof awaiting review, agreement deadline approaching.",
    start: "2026-10-05", officialMonths: 0, progressCourses: ["startup-personal-growth", "startup-learning-tech"],
    program: { signedDaysAgo: 26, activatedDaysAgo: 20 }, checkpointsDone: ["file_opened"], sessionRequest: true,
    notes: ["DEMO internal: parents asked to split the payment in four; third installment proof received, not yet checked."],
    evidencePending: true,
    billing: { agreed: 400000, installments: [["2026-10-05", 100000], ["2026-11-02", 100000], ["2026-12-01", 100000], ["2027-01-04", 100000]], receipts: [["2026-10-05", 100000, "DEMO-P8-1"], ["2026-11-02", 100000, "DEMO-P8-2"]] },
  },
  {
    // The only DEGREE student of the cohort: degree Roadmap + "Beyond the Bachelor's". No billing (owner: "minus the money part").
    key: BACHELORS_KEY, first: "DEMO Avery", last: "Bachelor's plan (synthetic)", email: `s27.p9@${DOMAIN}`,
    story: "Bachelor's degree: 60 credits already earned (prior college + workplace training), 51 planned with two course providers, 9 still open; target finish around March 2027.",
    degree: true, guardian: false,
    profile: { dob: "1994-03-12", hs_completion: true, prior_credits: true, prior_sources: ["community_college", "workplace_training"], target_degree: "Bachelor of Science in Business Administration (DEMO)", target_major: "Business Administration" },
    program: { signedDaysAgo: 70, activatedDaysAgo: 60, goal: DEMO_BACHELORS_GOAL }, checkpointsDone: ["file_opened", "program_activated"],
    notes: ["DEMO internal: degree student; SCI110 waiting for the university's pre-approval."],
  },
];

/** Extra tickets on the original demo accounts (onboarding, access, guardian consent). */
export const EXTRA_TICKETS: Record<string, Persona["tickets"]> = {
  "DEMO-S26-FR": [
    { seed: "fr-t1", subject: "DEMO — Première connexion à la plateforme de l’école", topic: "account_technical", category: "technical", priority: "medium", status: "resolved", messages: [
      { by: "student", text: "DEMO : Je n’arrive pas à me connecter à la plateforme de l’école.", daysAgo: 10 },
      { by: "staff", text: "DEMO : Vos accès arrivent par courriel de l’école après l’activation; nous avons demandé un renvoi.", daysAgo: 9 },
      { by: "student", text: "DEMO : C’est bon, merci !", daysAgo: 8 }] },
  ],
  "DEMO-S26-SECOND": [
    { seed: "sec-t1", subject: "DEMO — Guardian consent form", topic: "general", category: "enrollment", priority: "medium", status: "open", messages: [
      { by: "student", text: "DEMO: Which document does my guardian need to sign before enrollment?", daysAgo: 1 }] },
  ],
};

const iso = (d: Date) => d.toISOString();
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86400000));

async function ensureAccount(ctx: Ctx, email: string, name: string): Promise<string> {
  const ex = await ctx.supabaseAdmin.from("users").select("id,role,name").eq("email", email).maybeSingle();
  if (ex.data) { if (ex.data.role !== "student" || !String(ex.data.name).startsWith("DEMO")) throw new Error("NON_DEMO_ACCOUNT"); return ex.data.id; }
  const created = await ctx.supabaseAdmin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: name, synthetic_demo: true } });
  if (created.error || !created.data.user) throw new Error(`auth create: ${created.error?.message}`);
  const id = created.data.user.id;
  const up = await ctx.supabaseAdmin.from("users").upsert({ id, email, name, role: "student" }, { onConflict: "id" });
  if (up.error) throw new Error(`users row: ${up.error.message}`);
  await ctx.supabaseAdmin.from("profiles").upsert({ user_id: id, status: "active" }, { onConflict: "user_id", ignoreDuplicates: true });
  return id;
}

async function ensureStudent(ctx: Ctx, p: { key: string; first: string; last: string; email: string; profile?: Record<string, unknown> }, userId: string) {
  const { createStudent, getStudentByUserId } = await import("../../server/services/student-service");
  const { changeStudentStatus } = await import("../../server/services/admin-student-status");
  let s = await getStudentByUserId(userId);
  if (s && !String(s.preferred_name).startsWith("DEMO")) throw new Error("NON_DEMO_STUDENT");
  if (!s) s = await createStudent({
    user_id: userId, status: "lead", first_name: p.first, last_name: p.last, middle_name: null, preferred_name: p.key, sex: null,
    gov_id_type: null, gov_id_number: null, photo_url: null, dob: "2009-06-15", nationality: ["MA"], residency: "foreign", email: p.email,
    phone_primary: "+212600000099", preferred_contact_channel: "email", phone_secondary: null, whatsapp_primary: false, timezone: "Africa/Casablanca",
    address_country: "MA", address_line1: "DEMO — fictional address", address_state: null, address_city: "DEMO city", address_postal: null, address_line2: null,
    hs_path: null, hs_country: "MA", hs_school: null, hs_year: null, hs_doc_url: null, hs_completion: false, prior_credits: false, prior_sources: [],
    transcripts_url: [], target_degree: null, target_major: null, start_term: null, prior_credits_est: null, target_pace: null, consent_signature: null,
    marketing_opt_in: false, media_release: false, ...p.profile,
  } as never, ctx.actorId);
  if (s.status === "lead") s = await changeStudentStatus(s.id, "active", ctx.actorId, { provisioning: "s26-demo-cohort", note: DEMO_TAG }) as typeof s;
  return s;
}

async function uploadDemoPdf(ctx: Ctx, student: { id: string; student_code: string }, type: string, name: string): Promise<string> {
  const { generateDocumentUpload, createDocumentRecord } = await import("../../server/services/document-service");
  const bytes = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\n% ${DEMO_TAG} ${name}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
  const up = await generateDocumentUpload(student.id, student.student_code, type, name, bytes.length, "application/pdf");
  const put = await ctx.supabaseAdmin.storage.from("student-documents").upload(up.storage_path, bytes, { contentType: "application/pdf", upsert: false });
  if (put.error) throw new Error(`storage: ${put.error.message}`);
  const doc = await createDocumentRecord(student.id, { doc_type: type, file_name: name, storage_path: up.storage_path, notes: `${DEMO_TAG}` } as never, ctx.actorId, { staff: true });
  return doc.id;
}

async function seedDocuments(ctx: Ctx, student: any, docs: NonNullable<Persona["documents"]>) {
  const { listStudentDocuments, verifyDocument, requestResubmit, rejectDocument } = await import("../../server/services/document-service");
  const existing = await listStudentDocuments(student.id);
  for (const d of docs) {
    if (existing.some((x: any) => x.file_name === d.name)) continue;
    const id = await uploadDemoPdf(ctx, student, d.type, d.name);
    if (d.state === "verified") await verifyDocument(id, ctx.actorId, DEMO_TAG);
    if (d.state === "resubmit_requested") await requestResubmit(id, ctx.actorId, { studentMessage: d.message ?? "DEMO", internalNote: DEMO_TAG } as never);
    if (d.state === "rejected") await rejectDocument(id, ctx.actorId, { studentMessage: d.message ?? "DEMO", internalNote: DEMO_TAG } as never);
  }
}

async function seedAcademics(ctx: Ctx, student: any, userId: string, p: Persona) {
  const { defaultHighSchoolService: hs } = await import("../../server/services/high-school-service.default");
  const { createEnrollmentSchema } = await import("../../shared/high-school-contract");
  let state = await hs.getStaffState(student.id);
  if (!state.current) {
    state = (await hs.createEnrollment(student.id, ctx.actorId, createEnrollmentSchema.parse({
      templateKey: "us-hs-diploma-21", templateVersion: 3, status: "active", startedOn: p.contract ? null : p.start, targetCompletionDate: null,
    }))).result;
  }
  const eid = state.current!.enrollment.id;
  if (!state.current!.published) {
    if (!state.current!.draft) state = (await hs.draftFromTemplate(student.id, eid, ctx.actorId, undefined)).result;
    const d = state.current!.draft!;
    let content = p.contract ? makeContractPlan(d.content) : makeDemoPlan(d.content, p.start);
    content = { ...content, studentMessage: `${DEMO_TAG}. ${p.story}`.slice(0, 600) };
    state = (await hs.saveDraft(student.id, eid, ctx.actorId, { expectedDraftRevision: d.draftRevision, content })).result;
    state = (await hs.publish(student.id, eid, ctx.actorId, { expectedDraftRevision: state.current!.draft!.draftRevision, expectedPublishedVersionId: null })).result;
  }
  const plan = state.current!.published!.content;
  // Synthetic official results: courses of the first N plan months, evidenced by a DEMO school report.
  if (p.officialMonths && state.current!.awards.length === 0) {
    const evidence = await uploadDemoPdf(ctx, student, "other", "DEMO-school-result-report.pdf");
    const { verifyDocument } = await import("../../server/services/document-service");
    await verifyDocument(evidence, ctx.actorId, DEMO_TAG);
    const startMs = Date.parse(`${p.start}T00:00:00Z`);
    const cutoff = new Date(startMs); cutoff.setUTCMonth(cutoff.getUTCMonth() + p.officialMonths);
    const done = plan.courses.filter((c) => c.plannedEnd && Date.parse(`${c.plannedEnd}T00:00:00Z`) < cutoff.getTime());
    for (const c of done) {
      await hs.recordCourseResult(student.id, eid, ctx.actorId, { courseKey: c.key, outcome: "completed", evidenceDocumentId: evidence, note: `${DEMO_TAG} — synthetic result` } as never);
    }
  }
  // Student-reported progress on the persona's current courses (as the student).
  for (const key of p.progressCourses ?? []) {
    const course = plan.courses.find((c) => c.key === key);
    for (const [i, task] of (course?.tasks ?? []).slice(0, 2).entries()) {
      try {
        await hs.reportProgress(student.id, userId, { courseKey: key, taskKey: task.key, status: i === 0 ? "submitted" : "in_progress", note: "DEMO progress", expectedRevision: 0 } as never);
      } catch { /* already reported (revision moved on) */ }
    }
  }
}

async function seedBilling(ctx: Ctx, studentId: string, b: NonNullable<Persona["billing"]>) {
  const { defaultBillingService: billing } = await import("../../server/services/billing-service.default");
  const view = await billing.getStaffView(studentId);
  if (view.student.state === "configured") return;
  await billing.setObligation(studentId, ctx.actorId, { agreedCents: b.agreed, currency: "USD", note: `${DEMO_TAG} — synthetic agreed price` });
  if (b.discount) await billing.addDiscount(studentId, ctx.actorId, { amountCents: b.discount, reason: `${DEMO_TAG} — synthetic approved adjustment` });
  if (b.installments?.length) await billing.setInstallments(studentId, ctx.actorId, { installments: b.installments.map(([dueDate, amountCents], i) => ({ dueDate, amountCents, label: `DEMO installment ${i + 1}` })) });
  for (const [receivedDate, amountCents, reference] of b.receipts ?? []) {
    await billing.recordReceipt(studentId, ctx.actorId, { amountCents, receivedDate, methodLabel: "DEMO bank transfer (synthetic)", reference, note: `${DEMO_TAG} — not a real payment` });
  }
  if (b.voidFirstReceipt) {
    const v = await billing.getStaffView(studentId);
    const wrong = v.receipts.find((r) => r.reference === "DEMO-P7-WRONG");
    if (wrong) await billing.voidReceipt(studentId, ctx.actorId, wrong.id, "DEMO — entered with the wrong amount; corrected");
  }
}

const dayOffset = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/** S27 (synthetic students only): agreement, checkpoints, an orientation-session request, staff notes, a pending payment proof. */
async function seedProgram(ctx: Ctx, student: any, userId: string, p: Persona) {
  const { defaultProgramJourneyService: journey } = await import("../../server/services/program-journey/service.default");
  if (p.program && !(await journey.getAgreementView(student.id))) {
    const g = p.program;
    await journey.updateAgreement(student.id, ctx.actorId, {
      signedOn: dayOffset(g.signedDaysAgo),
      ...(g.activatedDaysAgo !== undefined ? { activatedOn: dayOffset(g.activatedDaysAgo) } : {}),
      ...(g.languageTestDone ? { languageTest: { status: "done" as const, doneOn: dayOffset(g.signedDaysAgo - 12), score: 112, target: "105–115" } } : {}),
      ...(g.goal && typeof g.goal === "object" ? { goal: g.goal } : {}),
      ...(g.goal === true ? { goal: { field: "Communication", region: "Québec", interests: ["Media", "Languages"], targets: [{ name: "DEMO University (fictional)", city: "DEMO city", track: "French track", program: "Communication (demo)", why: "DEMO — synthetic example.", admission: "DEMO — synthetic example.", url: null }], alsoReviewed: ["DEMO College (fictional)"], studyOn: null } } : {}),
    });
  }
  // Only checkpoints not yet done, so a re-run (on any day) leaves the existing rows unchanged.
  const done = new Set((await journey.getJourney(student.id)).checkpoints.filter((c) => c.status === "done").map((c) => c.key as string));
  for (const key of p.checkpointsDone ?? []) if (!done.has(key)) await journey.completeCheckpoint(student.id, key as never, ctx.actorId, { doneOn: dayOffset(30) });
  if (p.sessionRequest && (await journey.listStudentSessions(student.id)).length === 0) {
    await journey.requestSession(student.id, userId, { slotAt: new Date(Date.now() + 5 * 86400000).toISOString(), prep: { "DEMO question": ["Plan my weeks"] }, channel: "portal" });
  }
  if ((await journey.countNotes(student.id)) === 0) for (const n of p.notes ?? []) await journey.addNote(student.id, ctx.actorId, n);
  if (p.evidencePending) {
    const { defaultBillingService: billing } = await import("../../server/services/billing-service.default");
    const view = await billing.getStaffView(student.id);
    if (view.evidence.length === 0) {
      const doc = await uploadDemoPdf(ctx, student, "other", "DEMO-payment-proof.pdf");
      await billing.registerEvidence(student.id, userId, { documentId: doc, note: "DEMO payment proof (synthetic)" });
    }
  }
}

async function seedTickets(ctx: Ctx, student: any, userId: string, tickets: NonNullable<Persona["tickets"]>) {
  const db = ctx.supabaseAdmin;
  for (const t of tickets) {
    const ex = await db.from("support_tickets").select("id").eq("reporter_id", userId).contains("metadata", { demo_seed: t.seed }).limit(1);
    if (ex.error) throw new Error(`ticket lookup: ${ex.error.message}`);
    if (ex.data?.length) continue;
    const first = t.messages[0];
    const created = await db.from("support_tickets").insert({
      reporter_id: userId, reporter_name: `${student.first_name} ${student.last_name}`, reporter_email: student.email,
      subject: t.subject, description: first.text, category: t.category, priority: t.priority, status: t.status,
      metadata: { topic: t.topic, synthetic: true, demo_seed: t.seed }, created_at: daysAgo(first.daysAgo), updated_at: daysAgo(t.messages[t.messages.length - 1].daysAgo),
      ...(t.status === "resolved" ? { resolved_at: daysAgo(t.messages[t.messages.length - 1].daysAgo) } : {}),
    }).select("id").single();
    if (created.error) throw new Error(`ticket insert: ${created.error.message}`);
    for (const m of t.messages) {
      const c = await db.from("ticket_comments").insert({
        ticket_id: created.data.id,
        author_id: m.by === "student" ? userId : ctx.actorId,
        author_name: m.by === "student" ? `${student.first_name} ${student.last_name}` : "Lumière team (DEMO)",
        author_role: m.by === "student" ? "student" : "admin",
        content: m.text, is_internal: !!m.internal, created_at: daysAgo(m.daysAgo),
      });
      if (c.error) throw new Error(`comment insert: ${c.error.message}`);
    }
  }
}

async function ensureGuardian(studentId: string, actorId: string) {
  const { getStudentContacts, addStudentContact } = await import("../../server/services/student-service");
  if ((await getStudentContacts(studentId)).some((c) => c.full_name.startsWith("DEMO"))) return;
  await addStudentContact(studentId, { type: "guardian", full_name: "DEMO Guardian (fictional)", relationship: "Guardian (DEMO)", phone: "+212600000098",
    email: `guardian.${crypto.randomBytes(3).toString("hex")}@${DOMAIN}`, language: "fr", scopes: [], consent_doc_url: null, authority_status: "listed" } as never, actorId);
}

async function ensurePhoto(ctx: Ctx, student: any) {
  if (student.photo_url) return;
  const { updateStudent } = await import("../../server/services/student-service");
  const path = `profile-photos/${student.id}_${crypto.randomUUID()}.jpg`;
  const up = await ctx.supabaseAdmin.storage.from("student-documents").upload(path, fs.readFileSync("scripts/s26/assets/demo-avatar-second.jpg"), { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(`photo: ${up.error.message}`);
  await updateStudent(student.id, { photo_url: `storage:student-documents/${path}` } as never, ctx.actorId);
}

/** One persona; failures are recorded per step in ctx.warnings, never thrown. Returns null when no student exists. */
export async function provisionPersona(ctx: Ctx, p: Persona): Promise<{ studentId: string; code: string } | null> {
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { ctx.warnings[`${p.key}.${name}`] = String((e as Error)?.message ?? e).slice(0, 200); }
  };
  let userId = "", student: any = null;
  await step("account", async () => { userId = await ensureAccount(ctx, p.email, `${p.first} ${p.last}`); });
  if (!userId) return null;
  await step("student", async () => { student = await ensureStudent(ctx, p, userId); });
  if (!student) return null;
  if (p.guardian !== false) await step("guardian", () => ensureGuardian(student.id, ctx.actorId));
  await step("photo", () => ensurePhoto(ctx, student));
  if (p.start || p.contract) await step("academics", () => seedAcademics(ctx, student, userId, p));
  if (p.degree) await seedBachelorsDegree(step, student.id, userId, ctx.actorId);
  if (p.documents) await step("documents", () => seedDocuments(ctx, student, p.documents!));
  if (p.billing) await step("billing", () => seedBilling(ctx, student.id, p.billing!));
  if (p.program || p.checkpointsDone || p.notes) await step("program", () => seedProgram(ctx, student, userId, p));
  if (p.tickets) await step("tickets", () => seedTickets(ctx, student, userId, p.tickets!));
  return { studentId: student.id, code: student.student_code };
}

/** Provision every persona; failures are recorded per persona and step, never thrown. */
export async function provisionDemoCohort(ctx: Ctx, realCode: string | null): Promise<Record<string, unknown>> {
  const report: Record<string, unknown> = {};
  const step = async (persona: string, name: string, fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { ctx.warnings[`${persona}.${name}`] = String((e as Error)?.message ?? e).slice(0, 200); }
  };
  const all: Persona[] = [...PERSONAS];
  if (realCode) all.push({
    key: `DEMO-MIRROR-${realCode}`, first: "DEMO Mirror", last: "First-student scenario (synthetic)", email: `s26.mirror@${DOMAIN}`,
    story: "Demonstration mirror of the first student's agreed 16-week plan. Synthetic data only; the real student's record is separate and unchanged.",
    contract: true, officialMonths: 0, progressCourses: ["startup-personal-growth", "english-1"],
    billing: { agreed: 400000 }, documents: [{ type: "id_gov", name: "DEMO-mirror-id.pdf", state: "pending" }],
    tickets: [{ seed: "mirror-t1", subject: "DEMO — Bienvenue : première semaine", topic: "general", category: "general", priority: "low", status: "waiting_on_student", messages: [
      { by: "staff", text: "DEMO : Bienvenue ! Votre première semaine : orientation, Foundations of Personal Growth et English 1. Dites-nous si vous avez des questions.", daysAgo: 1 }] }],
  });
  for (const p of all) {
    const out = await provisionPersona(ctx, p);
    if (out) report[p.key] = out;
  }
  for (const [key, tickets] of Object.entries(EXTRA_TICKETS)) {
    await step(key, "tickets", async () => {
      const { data } = await ctx.supabaseAdmin.from("students").select("id,user_id,first_name,last_name,email").eq("preferred_name", key).maybeSingle();
      if (data?.user_id) await seedTickets(ctx, data, data.user_id, tickets!);
    });
  }
  return report;
}
