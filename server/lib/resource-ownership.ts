import { getStudentByUserId } from "../services/student-service";
import { getStudent } from "../services/student-service";

type AuthenticatedOwner = {
  readonly id: string;
  readonly role?: string;
};

/**
 * Resource ownership is always resolved from the stored resource row and the
 * authenticated session. Client payloads never participate in this decision.
 */
export async function studentOwnsProfile(
  user: AuthenticatedOwner,
  studentId: string,
  lookup: typeof getStudentByUserId = getStudentByUserId,
): Promise<boolean> {
  if (user.role !== "student") return true;
  const profile = await lookup(user.id);
  return profile?.id === studentId;
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