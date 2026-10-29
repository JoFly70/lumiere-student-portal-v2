/**
 * Owner Command Center (/admin/support-center): greeting, what needs the owner now, real-student KPIs that link to
 * the filtered records, a students preview and recent activity. All data and layout live in ControlCenterLive.
 */
import React from "react";
import { ControlCenterLive } from "@/components/admin/control-center-live";
import { StaffPage } from "@/components/staff/staff-ui";

export default function AdminSupportCenter() {
  return (
    <StaffPage width="wide" className="pb-8" testId="admin-support-center">
      <ControlCenterLive />
    </StaffPage>
  );
}
