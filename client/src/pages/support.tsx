/** Support page: a thin role switch. Students and staff get different surfaces. */
import { useAuth } from "@/lib/auth";
import { isSupportStaffRole } from "@shared/support-contract";
import { StudentSupportCenter } from "@/components/support/student-support-center";
import { StaffSupportDesk } from "@/components/support/staff-support-desk";

export default function Support() {
  const { user } = useAuth();
  return isSupportStaffRole(user?.role) ? <StaffSupportDesk /> : <StudentSupportCenter />;
}
