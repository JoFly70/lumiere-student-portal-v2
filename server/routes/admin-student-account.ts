/**
 * Staff API (admin only) that links an authenticated portal account to a
 * student record, mounted under /api/admin. Student routes resolve the student
 * from `students.user_id`, so this link is what makes /api/student/* work.
 *
 *   GET  /api/admin/students/:studentId/account
 *   POST /api/admin/students/:studentId/account/link    { userId }
 *   POST /api/admin/students/:studentId/account/unlink  { reason }
 *   POST /api/admin/students/:studentId/email           { email, reason }   (S32-B: correct the record email)
 *
 * S32-B: the account view also carries the enrollment status (latest invitation for the record email, ready to
 * link, linked) so the Student File can show where the student is and the one next action. The link itself still
 * requires an administrator's explicit confirmation; nothing is linked or activated automatically.
 *
 * Linking is refused unless the account is a student-role user whose email
 * equals the student record's email (case-insensitive) and is not already
 * linked anywhere. Check + update run in one transaction with the student row
 * locked and a conditional UPDATE.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { logger } from "../lib/logger";
import { auditAdmin } from "../lib/audit";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/rbac";
import { deriveEnrollmentStatus, invitationState, isPlausibleEmail, type EnrollmentStatus, type InvitationFacts } from "@shared/enrollment-status";

export interface AccountView {
  studentId: string;
  studentEmail: string;
  linked: boolean;
  account: { userId: string; email: string; role: string } | null;
  candidates: Array<{ userId: string; email: string; name: string; createdAt: string }>;
  /** S32-B: latest invitation sent to the record email (no code, no hash). */
  invitation?: InvitationFacts;
  /** S32-B: derived enrollment stage and next action. */
  enrollment?: EnrollmentStatus;
}

export class AccountLinkError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const linkSchema = z.object({ userId: z.string().trim().regex(UUID, "userId must be a UUID") }).strict();
const unlinkSchema = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
const emailSchema = z.object({ email: z.string().trim().min(3).max(254), reason: z.string().trim().min(5).max(500) }).strict();

async function loadView(tx: Exec, studentId: string): Promise<AccountView> {
  const [student] = rowsOf(await tx.execute(sql`select id, email, user_id from students where id = ${studentId}`));
  if (!student) throw new AccountLinkError(404, "STUDENT_NOT_FOUND", "Student not found");
  const studentEmail = String(student.email ?? "");
  let account: AccountView["account"] = null;
  if (student.user_id) {
    const [u] = rowsOf(await tx.execute(sql`select id, email, role::text as role from users where id = ${String(student.user_id)}`));
    account = u ? { userId: String(u.id), email: String(u.email), role: String(u.role) } : { userId: String(student.user_id), email: "", role: "unknown" };
  }
  let candidates: AccountView["candidates"] = [];
  if (!student.user_id && studentEmail) {
    const rows = rowsOf(
      await tx.execute(sql`
        select u.id, u.email, u.name, u.created_at from users u
        where u.role::text = 'student' and lower(u.email) = lower(${studentEmail})
          and not exists (select 1 from students s where s.user_id = u.id)
        order by u.created_at`),
    );
    candidates = rows.map((u) => ({
      userId: String(u.id),
      email: String(u.email),
      name: String(u.name ?? ""),
      createdAt: new Date(u.created_at).toISOString(),
    }));
  }
  let invitation: InvitationFacts | null = null;
  if (studentEmail) {
    try {
      const [inv] = rowsOf(await tx.execute(sql`
        select created_at, expires_at, consumed_at, revoked_at from account_invitations
        where email = lower(${studentEmail}) order by created_at desc limit 1`));
      invitation = invitationState(inv ? {
        createdAt: new Date(inv.created_at).toISOString(), expiresAt: new Date(inv.expires_at).toISOString(),
        consumedAt: inv.consumed_at ? new Date(inv.consumed_at).toISOString() : null, revokedAt: inv.revoked_at ? new Date(inv.revoked_at).toISOString() : null,
      } : null, new Date());
    } catch (error) {
      // Before the S14 account gate the table is absent: the status simply has no invitation facts.
      if ((error as { code?: string })?.code !== "42P01") throw error;
    }
  }
  const linked = !!student.user_id;
  const enrollment = deriveEnrollmentStatus({ studentEmail, linked, candidateCount: candidates.length, invitation });
  return { studentId: String(student.id), studentEmail, linked, account, candidates, invitation: enrollment.invitation, enrollment };
}

/**
 * S32-B: correct a mistyped record email. Admin only; allowed only while no portal account is linked (so a linked
 * identity is never re-pointed); refused when another student record already uses the address or when the address
 * belongs to a non-student account. The old and new addresses are written to the audit log by the route.
 */
export async function correctStudentEmail(studentId: string, rawEmail: string): Promise<{ view: AccountView; previousEmail: string; email: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!isPlausibleEmail(email)) throw new AccountLinkError(400, "EMAIL_INVALID", "Enter a valid email address");
  return db.transaction(async (tx) => {
    const [student] = rowsOf(await tx.execute(sql`select id, email, user_id from students where id = ${studentId} for update`));
    if (!student) throw new AccountLinkError(404, "STUDENT_NOT_FOUND", "Student not found");
    if (student.user_id) throw new AccountLinkError(409, "STUDENT_ALREADY_LINKED", "Unlink the portal account before correcting the record email");
    const previousEmail = String(student.email ?? "");
    if (previousEmail.trim().toLowerCase() === email) throw new AccountLinkError(409, "EMAIL_UNCHANGED", "The record already uses this email");
    const [taken] = rowsOf(await tx.execute(sql`select id from students where lower(email) = ${email} and id <> ${studentId} limit 1`));
    if (taken) throw new AccountLinkError(409, "STUDENT_EMAIL_TAKEN", "Another student record already uses this email");
    const [staffUser] = rowsOf(await tx.execute(sql`select id from users where lower(email) = ${email} and role::text <> 'student' limit 1`));
    if (staffUser) throw new AccountLinkError(409, "EMAIL_BELONGS_TO_STAFF", "This email belongs to a staff account");
    const updated = rowsOf(await tx.execute(sql`update students set email = ${email}, email_verified_at = null, updated_at = now() where id = ${studentId} and user_id is null returning id`));
    if (updated.length !== 1) throw new AccountLinkError(409, "STUDENT_ALREADY_LINKED", "Unlink the portal account before correcting the record email");
    return { view: await loadView(tx as unknown as Exec, studentId), previousEmail, email };
  });
}

export async function linkStudentAccount(studentId: string, userId: string): Promise<AccountView> {
  return db.transaction(async (tx) => {
    const [student] = rowsOf(await tx.execute(sql`select id, email, user_id from students where id = ${studentId} for update`));
    if (!student) throw new AccountLinkError(404, "STUDENT_NOT_FOUND", "Student not found");
    if (student.user_id) throw new AccountLinkError(409, "STUDENT_ALREADY_LINKED", "This student record already has a linked account");
    const [user] = rowsOf(await tx.execute(sql`select id, email, role::text as role from users where id = ${userId} for update`));
    if (!user) throw new AccountLinkError(404, "ACCOUNT_NOT_FOUND", "Account not found");
    if (user.role !== "student") throw new AccountLinkError(422, "ACCOUNT_NOT_STUDENT", "Only student accounts can be linked to a student record");
    const [other] = rowsOf(await tx.execute(sql`select id from students where user_id = ${userId} and id <> ${studentId} limit 1`));
    if (other) throw new AccountLinkError(409, "ACCOUNT_ALREADY_LINKED", "This account is already linked to another student record");
    if (String(user.email ?? "").trim().toLowerCase() !== String(student.email ?? "").trim().toLowerCase()) {
      throw new AccountLinkError(422, "EMAIL_MISMATCH", "The account email does not match the student record email");
    }
    const updated = rowsOf(await tx.execute(sql`update students set user_id = ${userId} where id = ${studentId} and user_id is null returning id`));
    if (updated.length !== 1) throw new AccountLinkError(409, "STUDENT_ALREADY_LINKED", "This student record already has a linked account");
    return loadView(tx as unknown as Exec, studentId);
  });
}

export async function unlinkStudentAccount(studentId: string): Promise<{ view: AccountView; previousUserId: string }> {
  return db.transaction(async (tx) => {
    const [student] = rowsOf(await tx.execute(sql`select id, user_id from students where id = ${studentId} for update`));
    if (!student) throw new AccountLinkError(404, "STUDENT_NOT_FOUND", "Student not found");
    if (!student.user_id) throw new AccountLinkError(409, "STUDENT_NOT_LINKED", "This student record has no linked account");
    const previousUserId = String(student.user_id);
    await tx.execute(sql`update students set user_id = null where id = ${studentId} and user_id = ${previousUserId}`);
    return { view: await loadView(tx as unknown as Exec, studentId), previousUserId };
  });
}

export interface AdminStudentAccountDeps {
  readonly getView?: (studentId: string) => Promise<AccountView>;
  readonly correctEmail?: typeof correctStudentEmail;
  readonly audit?: (actorId: string, description: string, metadata: Record<string, unknown>, targetUserId?: string, revoked?: boolean) => Promise<void>;
}

const defaultAudit: NonNullable<AdminStudentAccountDeps["audit"]> = async (actorId, description, metadata, targetUserId, revoked) => {
  await auditAdmin(revoked ? "admin.permission_revoked" : "admin.permission_granted", actorId, targetUserId, description, metadata);
};

function sendError(res: Response, error: unknown, context: string) {
  if (error instanceof AccountLinkError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
  logger.error(`Student account ${context} failed`, { error: error instanceof Error ? error.message : String(error) });
  return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
}

export function createAdminStudentAccountRouter(deps: AdminStudentAccountDeps = {}) {
  const router = Router();
  const guards: RequestHandler[] = [requireAuth, requireRole(["admin"])];
  const getView = deps.getView ?? ((id: string) => db.transaction((tx) => loadView(tx as unknown as Exec, id)));
  const audit = deps.audit ?? defaultAudit;

  const safeAudit = async (...args: Parameters<typeof audit>) => {
    try {
      await audit(...args);
    } catch (error) {
      logger.error("Student account audit failed", { error: error instanceof Error ? error.message : String(error) });
    }
  };
  const validId = (req: Request, res: Response): string | null => {
    const id = String(req.params.studentId ?? "");
    if (!UUID.test(id)) {
      res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "studentId must be a UUID" } });
      return null;
    }
    return id;
  };

  router.get("/students/:studentId/account", ...guards, async (req, res) => {
    const studentId = validId(req, res);
    if (!studentId) return;
    try {
      res.json(await getView(studentId));
    } catch (error) {
      sendError(res, error, "read");
    }
  });

  router.post("/students/:studentId/account/link", ...guards, async (req, res) => {
    const studentId = validId(req, res);
    if (!studentId) return;
    const parsed = linkSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "Invalid request" } });
    try {
      const view = await linkStudentAccount(studentId, parsed.data.userId);
      await safeAudit(req.user!.id, "Linked portal account to student record", { action: "student_account_linked", studentId, userId: parsed.data.userId }, parsed.data.userId);
      res.json(view);
    } catch (error) {
      sendError(res, error, "link");
    }
  });

  router.post("/students/:studentId/account/unlink", ...guards, async (req, res) => {
    const studentId = validId(req, res);
    if (!studentId) return;
    const parsed = unlinkSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "A reason of at least 5 characters is required" } });
    try {
      const { view, previousUserId } = await unlinkStudentAccount(studentId);
      await safeAudit(
        req.user!.id,
        "Unlinked portal account from student record",
        { action: "student_account_unlinked", studentId, userId: previousUserId, reason: parsed.data.reason },
        previousUserId,
        true,
      );
      res.json(view);
    } catch (error) {
      sendError(res, error, "unlink");
    }
  });

  router.post("/students/:studentId/email", ...guards, async (req, res) => {
    const studentId = validId(req, res);
    if (!studentId) return;
    const parsed = emailSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: { code: "VALIDATION_FAILED", message: "An email and a reason of at least 5 characters are required" } });
    try {
      const out = await (deps.correctEmail ?? correctStudentEmail)(studentId, parsed.data.email);
      await safeAudit(
        req.user!.id,
        "Corrected the student record email",
        { action: "student_email_corrected", studentId, previousEmail: out.previousEmail, email: out.email, reason: parsed.data.reason },
        undefined,
        false,
      );
      res.json(out.view);
    } catch (error) {
      sendError(res, error, "email correction");
    }
  });

  return router;
}

export default createAdminStudentAccountRouter();
