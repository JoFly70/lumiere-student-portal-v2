import { describe, expect, it, vi } from "vitest";
import {
  isStaffOwner,
  resolveStudentUserId,
  studentOwnsProfile,
  userOwnsTicket,
} from "../server/lib/resource-ownership";
import { ticketQueryParams } from "@/hooks/use-tickets";

describe("Phase 5D ownership and student support filtering", () => {
  it("resolves ticket filtering through the stored student profile user mapping", async () => {
    const lookup = vi.fn(async (studentId: string) => ({
      id: studentId,
      user_id: "stored-user-1",
    })) as any;
    await expect(resolveStudentUserId("student-1", lookup)).resolves.toBe("stored-user-1");
    expect(lookup).toHaveBeenCalledWith("student-1");
    await expect(resolveStudentUserId("missing", vi.fn(async () => null) as any)).resolves.toBeNull();
  });

  it("keeps document ownership tied to the stored student profile", async () => {
    const lookup = vi.fn(async (userId: string) => userId === "user-1"
      ? { id: "student-1", user_id: userId }
      : null) as any;
    await expect(studentOwnsProfile({ id: "user-1", role: "student" }, "student-1", lookup)).resolves.toBe(true);
    await expect(studentOwnsProfile({ id: "user-2", role: "student" }, "student-1", lookup)).resolves.toBe(false);
    expect(userOwnsTicket({ id: "user-1", role: "student" }, "user-1")).toBe(true);
    expect(userOwnsTicket({ id: "user-1", role: "student" }, "user-2")).toBe(false);
  });

  it("preserves staff and admin ownership behavior without widening student access", () => {
    expect(isStaffOwner({ id: "admin-1", role: "admin" })).toBe(true);
    expect(isStaffOwner({ id: "coach-1", role: "coach" })).toBe(true);
    expect(isStaffOwner({ id: "staff-1", role: "staff" })).toBe(true);
    expect(isStaffOwner({ id: "student-1", role: "student" })).toBe(false);
    expect(userOwnsTicket({ id: "admin-1", role: "admin" }, "other-user")).toBe(true);
  });

  it("sends only the selected student id to the existing tickets route", () => {
    expect(ticketQueryParams({ studentId: "student-1" }).toString()).toBe("studentId=student-1");
    expect(ticketQueryParams({ studentId: "student/1", status: "open" }).toString()).toBe(
      "studentId=student%2F1&status=open",
    );
  });
});