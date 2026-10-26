import { getStudentByUserId } from "../services/student-service";
import { getStudent } from "../services/student-service";

type AuthenticatedOwner = {
  readonly id: string;
  readonly role?: string;
};

/** Roles with organisation-wide access to student records. */
export function isAdminOrStaff(user: { readonly role?: string } | undefined | null): boolean {
  return user?.role === "admin" || user?.role === "staff";
}

/**
 * Resource ownership is always resolved from the stored resource row and the
 * authenticated session. Client payloads never participate in this decision.
 *
 * Deny by default: admin and staff are allowed; a student only for their own
 * stored profile. Coach and unknown roles are denied because there is no
 * coach-to-student assignment table to scope their access.
 */
export async function studentOwnsProfile(
  user: AuthenticatedOwner,
  studentId: string,
  lookup: typeof getStudentByUserId = getStudentByUserId,
): Promise<boolean> {
  if (isAdminOrStaff(user)) return true;
  if (user.role !== "student") return false;
  if (!studentId) return false;
  const profile = await lookup(user.id);
  return !!profile && profile.id === studentId;
}

export function userOwnsTicket(
  user: AuthenticatedOwner,
  reporterId: string,
): boolean {
  return user.role !== "student" || reporterId === user.id;
}

export function isStaffOwner(user: AuthenticatedOwner): boolean {
  return ["admin", "coach", "staff"].includes(user.role ?? "");
}

export async function resolveStudentUserId(
  studentId: string,
  lookup: typeof getStudent = getStudent,
): Promise<string | null> {
  const student = await lookup(studentId);
  return student?.user_id ?? null;
}