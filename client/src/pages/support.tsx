/** Support page: a thin role switch. Students get the restored original Support Center; staff keep the desk. */
import { useAuth } from "@/lib/auth";
import { isSupportStaffRole } from "@shared/support-contract";
import { OriginalStudentSupport } from "@/components/support/original-student-support";
import { StaffSupportDesk } from "@/components/support/staff-support-desk";

export default function Support() {
  const { user } = useAuth();
  return isSupportStaffRole(user?.role) ? <StaffSupportDesk /> : <OriginalStudentSupport />;
}
