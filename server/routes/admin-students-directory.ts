/**
 * Admin students directory facts (mounted under /api/admin): one read-only, aggregate row per student so the
 * directory and Command Center need no per-student requests. Admin/staff only, no-store, no PII beyond ids.
 * Facts are derived from stored records only (never invented): open high-school program, agreed/received money
 * (voided receipts excluded) and the last audited activity.
 */
import { Router, type Request, type RequestHandler, type Response } from "express";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { logger } from "../lib/logger";
import { emitAccessDenied } from "./high-school-audit";
import { guardRoles } from "./high-school-http";

export interface DirectoryFacts {
  studentId: string;
  /** `kind`: the open high-school program, or (when there is none) the active degree program assignment. */
  program: { title: string; status: string; kind: "high_school" | "degree" } | null;
  billing: { currency: string; agreedCents: number; netCents: number; paidCents: number; balanceCents: number; overdue: boolean } | null;
  lastActivityAt: string | null;
}

export interface StudentsDirectoryDeps {
  list: () => Promise<DirectoryFacts[]>;
  auth?: RequestHandler;
}

export function createAdminStudentsDirectoryRouter(deps: StudentsDirectoryDeps) {
  const router = Router();
  const auth: RequestHandler = deps.auth ?? (requireAuth as unknown as RequestHandler);
  router.get("/directory/students", auth, guardRoles(["admin", "staff"], emitAccessDenied), async (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      return res.json({ facts: await deps.list() });
    } catch (error) {
      logger.error("Students directory failed", { error: error instanceof Error ? error.message : String(error) });
      return res.status(500).json({ error: "Students directory unavailable" });
    }
  });
  return router;
}

/** "Bachelor of Science in Business Administration · 120 credits" (credits omitted when the version has no total). */
export function degreeProgramLabel(name: string, totalCredits: number | null): string {
  return totalCredits && totalCredits > 0 ? `${name} · ${totalCredits} credits` : name;
}

const rows = (res: unknown) => Array.from(res as Array<Record<string, unknown>>);
const iso = (v: unknown): string | null => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

async function listFacts(): Promise<DirectoryFacts[]> {
  const { db } = await import("../lib/db");
  const today = new Date().toISOString().slice(0, 10);
  const [students, programs, degrees, obligations, discounts, receipts, installments, activity] = await Promise.all([
    db.execute(sql`SELECT id::text AS id FROM students`),
    db.execute(sql`SELECT e.student_id::text AS student_id, e.status::text AS status, t.title
                     FROM hs_enrollments e JOIN hs_curriculum_templates t ON t.template_key = e.template_key AND t.version = e.template_version
                    WHERE e.status IN ('planned','active','on_hold')`),
    // Read-only: the one active degree assignment per student (unique index), one query for the whole list.
    db.execute(sql`SELECT a.student_id::text AS student_id, a.status::text AS status, p.name, pv.total_credits_required
                     FROM student_program_assignments a
                     JOIN knowledge_program_versions pv ON pv.id = a.program_version_id
                     JOIN knowledge_programs_v2 p ON p.id = pv.program_id
                    WHERE a.status = 'active'`),
    db.execute(sql`SELECT student_id::text AS student_id, agreed_cents::bigint AS agreed_cents, currency FROM student_billing_obligations`),
    db.execute(sql`SELECT student_id::text AS student_id, COALESCE(SUM(amount_cents),0)::bigint AS total FROM student_billing_discounts GROUP BY student_id`),
    db.execute(sql`SELECT student_id::text AS student_id, COALESCE(SUM(amount_cents),0)::bigint AS total FROM student_billing_receipts WHERE voided_at IS NULL GROUP BY student_id`),
    db.execute(sql`SELECT student_id::text AS student_id, COALESCE(SUM(amount_cents),0)::bigint AS due FROM student_billing_installments WHERE due_date < ${today}::date GROUP BY student_id`),
    db.execute(sql`SELECT target_resource_id::text AS student_id, MAX(created_at) AS last_at FROM audit_logs WHERE target_resource_id IS NOT NULL GROUP BY target_resource_id::text`),
  ]);
  const by = <T,>(r: unknown, pick: (x: Record<string, unknown>) => T) => new Map(rows(r).map((x) => [String(x.student_id), pick(x)] as const));
  const prog = by(programs, (x) => ({ title: String(x.title), status: String(x.status), kind: "high_school" as const }));
  const deg = by(degrees, (x) => ({ title: degreeProgramLabel(String(x.name), x.total_credits_required === null || x.total_credits_required === undefined ? null : Number(x.total_credits_required)), status: String(x.status), kind: "degree" as const }));
  const obl = by(obligations, (x) => ({ agreed: Number(x.agreed_cents), currency: String(x.currency) }));
  const disc = by(discounts, (x) => Number(x.total));
  const paid = by(receipts, (x) => Number(x.total));
  const due = by(installments, (x) => Number(x.due));
  const last = by(activity, (x) => iso(x.last_at));
  return rows(students).map((s) => {
    const id = String(s.id);
    const o = obl.get(id);
    const net = o ? Math.max(0, o.agreed - (disc.get(id) ?? 0)) : 0;
    const p = paid.get(id) ?? 0;
    return {
      studentId: id,
      program: prog.get(id) ?? deg.get(id) ?? null,
      billing: o ? { currency: o.currency, agreedCents: o.agreed, netCents: net, paidCents: p, balanceCents: Math.max(0, net - p), overdue: (due.get(id) ?? 0) > p } : null,
      lastActivityAt: last.get(id) ?? null,
    };
  });
}

export default createAdminStudentsDirectoryRouter({ list: listFacts });
