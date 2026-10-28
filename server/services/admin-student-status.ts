import { supabaseAdmin } from "../lib/supabase";
import { auditAdmin } from "../lib/audit";

/**
 * Shared administrative status operation. HTTP callers must retain their existing
 * admin middleware. The guarded staging provisioner may also call this operation
 * with explicit owner authorization; it never elevates the student's account.
 */
export async function changeStudentStatus(
  studentId: string,
  status: string,
  actorId: string,
  metadata: Record<string, unknown> = {},
) {
  if (!["lead", "active", "paused", "graduated"].includes(status)) {
    throw new Error("Invalid student status");
  }
  const previous = await supabaseAdmin.from("students").select("status").eq("id", studentId).single();
  if (previous.error || !previous.data) throw new Error("Student status unavailable");
  const { data: student, error } = await supabaseAdmin
    .from("students").update({ status }).eq("id", studentId).select().single();
  if (error || !student) throw new Error("Failed to update student status");
  await auditAdmin("admin.bulk_operation", actorId, student.user_id,
    `Changed student status to ${status}`,
    { ...metadata, studentId, oldStatus: previous.data.status, newStatus: status });
  return student;
}
