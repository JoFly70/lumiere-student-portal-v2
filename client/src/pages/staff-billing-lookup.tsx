/**
 * Staff entry to student billing (S20): /staff/billing, staff + admin.
 * Staff cannot open the admin-only student workspace, so this is their real way in: enter the
 * student id (as shown on the student's record / support thread) and go to its billing page.
 * It reads nothing and grants nothing; the billing API enforces the role on every call.
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { StaffCard, StaffPage, StaffPageHeader, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";

export const staffStudentBillingHref = (studentId: string) => `/admin/students/${encodeURIComponent(studentId.trim())}/billing`;

export default function StaffBillingLookup() {
  const [, navigate] = useLocation();
  const [studentId, setStudentId] = useState("");
  const valid = studentId.trim().length > 0 && studentId.trim().length <= 128;
  return (
    <StaffPage testId="staff-billing-lookup">
      <StaffPageHeader eyebrow="Billing" title="Student billing" description="Open a student's billing: agreed price, schedule, proof of payment awaiting review and confirmed payments." />
      <StaffCard>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) navigate(staffStudentBillingHref(studentId));
          }}
        >
          <label className={staffLabel} htmlFor="staff-billing-student-id">Student ID</label>
          <input id="staff-billing-student-id" className={staffField} value={studentId} onChange={(e) => setStudentId(e.target.value)} autoComplete="off" spellCheck={false} data-testid="input-billing-student-id" />
          <button type="submit" className={staffBtn.primary} disabled={!valid} data-testid="button-open-student-billing">Open billing</button>
        </form>
      </StaffCard>
    </StaffPage>
  );
}
