/** S29 Owner Operations & Diagnostics Studio (/admin/diagnostics, admin only; the route guard enforces the role). */
import { StaffPage } from "@/components/staff/staff-ui";
import { DiagnosticsStudio } from "@/components/s29/ops/diagnostics-studio";

export default function AdminDiagnostics() {
  return (
    <StaffPage width="wide" className="max-w-[1640px] pb-8" testId="s29-admin-diagnostics">
      <DiagnosticsStudio />
    </StaffPage>
  );
}
