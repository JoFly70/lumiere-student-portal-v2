/**
 * S26 — "Experience as student" (mounted under /api/admin).
 *
 * POST /students/:studentId/experience -> { mirror, user, session }
 *
 * Gives an administrator a full, interactive STUDENT-ROLE session — but ONLY for a synthetic demo
 * account. For a synthetic student the session is that student's own demo login; for a real student
 * it is the student's DEMO MIRROR (preferred_name "DEMO-MIRROR-<student code>"), a separate synthetic
 * account that replays the real plan with demonstration data. A real student's own account is never
 * signed into, and no session is ever issued for an account that is not synthetic (.invalid email,
 * role student, DEMO-prefixed name). Admin only; audited as admin.user_impersonation (synthetic target).
 * No email is sent (server-side magic-link exchange). The session is handed to a separate browser tab
 * by the client and kept in that tab's sessionStorage, so the admin session is untouched.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { requireCsrf } from "../middleware/csrf";
import { createAuditLog, type AuditLogEntry } from "../lib/audit";
import { logger } from "../lib/logger";
import { emitAccessDenied } from "./high-school-audit";
import { guardRoles } from "./high-school-http";

export const MIRROR_PREFIX = "DEMO-MIRROR-";

export interface ExperienceStudent { id: string; user_id?: string | null; student_code?: string | null; preferred_name?: string | null; first_name: string; last_name: string }
export interface ExperienceAccount { id: string; email: string; name: string; role: string }
export interface ExperienceSession { access_token: string; refresh_token: string; expires_at: number }

export interface ExperienceDeps {
  getStudent: (id: string) => Promise<ExperienceStudent | null>;
  findMirror: (code: string) => Promise<ExperienceStudent | null>;
  getAccount: (userId: string) => Promise<ExperienceAccount | null>;
  issueSession: (email: string, userId: string) => Promise<ExperienceSession>;
  audit?: (entry: AuditLogEntry) => Promise<void>;
  auth?: RequestHandler;
  csrf?: RequestHandler;
}

/** A demo account is synthetic beyond doubt: .invalid email, student role, DEMO-prefixed student name. */
export function isDemoTarget(student: ExperienceStudent, account: ExperienceAccount | null): account is ExperienceAccount {
  return !!account && account.role === "student" && /\.invalid$/i.test(account.email)
    && /^DEMO/i.test(student.preferred_name ?? "") && account.id === student.user_id;
}

const idSchema = z.string().trim().min(1).max(128);

export function createAdminStudentExperienceRouter(deps: ExperienceDeps) {
  const router = Router();
  const audit = deps.audit ?? createAuditLog;
  router.post("/students/:studentId/experience", deps.auth ?? requireAuth, guardRoles(["admin"], emitAccessDenied), deps.csrf ?? requireCsrf,
    async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "no-store");
      const id = idSchema.safeParse(req.params.studentId);
      if (!id.success) return res.status(400).json({ error: { code: "VALIDATION", message: "Invalid student id" } });
      try {
        const student = await deps.getStudent(id.data);
        if (!student) return res.status(404).json({ error: { code: "STUDENT_NOT_FOUND", message: "Student not found" } });
        const synthetic = /^DEMO/i.test(student.preferred_name ?? "");
        const target = synthetic ? student : await deps.findMirror(student.student_code ?? "");
        if (!target?.user_id) {
          return res.status(404).json({ error: { code: "MIRROR_NOT_PROVISIONED", message: "No demonstration mirror exists for this student yet." } });
        }
        const account = await deps.getAccount(target.user_id);
        if (!isDemoTarget(target, account)) {
          // Defence in depth: never issue a session for anything that is not unmistakably synthetic.
          logger.warn("Experience refused: target is not a synthetic demo account", { studentId: id.data });
          return res.status(403).json({ error: { code: "NOT_A_DEMO_ACCOUNT", message: "Only synthetic demo accounts can be experienced." } });
        }
        const session = await deps.issueSession(account.email, account.id);
        void Promise.resolve(audit({
          eventType: "admin.user_impersonation",
          severity: "warning",
          actorUserId: req.user?.id,
          actorRole: req.user?.role,
          actorIp: req.ip,
          actorUserAgent: req.get?.("user-agent") ?? undefined,
          targetResourceType: "student",
          targetResourceId: target.id,
          actionDescription: synthetic
            ? "Admin opened an interactive session as a synthetic demo student"
            : "Admin opened the synthetic demo mirror of a real student's scenario (real account untouched)",
          metadata: { surface: "experience_as_student", requestedStudentId: id.data, mirror: !synthetic },
          isEducationalRecord: false,
        })).catch((e: unknown) => logger.warn("Experience audit failed", { error: e instanceof Error ? e.message : String(e) }));
        return res.json({
          mirror: { studentId: target.id, code: target.student_code ?? "", label: synthetic ? "this demo student" : `the scenario of ${student.student_code}` },
          user: { id: account.id, email: account.email, name: account.name, role: "student" as const },
          session,
        });
      } catch (error) {
        logger.error("Experience session failed", { error: error instanceof Error ? error.message : String(error) });
        return res.status(503).json({ error: { code: "UNAVAILABLE", message: "The demonstration session could not be opened." } });
      }
    });
  return router;
}

export function createDefaultAdminStudentExperienceRouter() {
  return createAdminStudentExperienceRouter({
    getStudent: async (id) => {
      const { getStudent } = await import("../services/student-service");
      return (await getStudent(id)) as ExperienceStudent | null;
    },
    findMirror: async (code) => {
      if (!/^[A-Z0-9-]{3,40}$/.test(code)) return null;
      const { supabaseAdmin } = await import("../lib/supabase");
      const { data } = await supabaseAdmin.from("students").select("id,user_id,student_code,preferred_name,first_name,last_name")
        .eq("preferred_name", `${MIRROR_PREFIX}${code}`).limit(1);
      return (data?.[0] as ExperienceStudent | undefined) ?? null;
    },
    getAccount: async (userId) => {
      const { supabaseAdmin } = await import("../lib/supabase");
      const { data } = await supabaseAdmin.from("users").select("id,email,name,role").eq("id", userId).maybeSingle();
      return (data as ExperienceAccount | null) ?? null;
    },
    issueSession: async (email, userId) => {
      const { supabaseAdmin, createUserAuthClient } = await import("../lib/supabase");
      const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email });
      const hashed = link.data?.properties?.hashed_token;
      if (link.error || !hashed) throw new Error("magic link generation failed");
      const signed = await createUserAuthClient().auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
      const s = signed.data.session;
      if (signed.error || !s || signed.data.user?.id !== userId) throw new Error("session exchange failed");
      return { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600 };
    },
  });
}

export default createDefaultAdminStudentExperienceRouter();
