/**
 * Owner Control Center (/admin/support-center; staff land here too with their allowed scope). The S27 redesign:
 * headline, KPI tiles, "Needs you today", next 14 days, assistant card, All students table, Payments, Support windows.
 * All data comes from GET /api/admin/control-center (see components/admin/control/control-center.tsx).
 */
import React from "react";
import { ControlCenter } from "@/components/admin/control/control-center";
import { StaffPage } from "@/components/staff/staff-ui";

export default function AdminSupportCenter() {
  return (
    <StaffPage width="wide" className="pb-8" testId="admin-support-center">
      <ControlCenter />
    </StaffPage>
  );
}
