/** S29 Staff Notification Center (/admin/notifications, admin + staff; concierge settings are admin only). */
import { StaffPage } from "@/components/staff/staff-ui";
import { NotificationsCenter } from "@/components/s29/ops/notifications-center";

export default function AdminNotifications() {
  return (
    <StaffPage width="wide" className="max-w-[1640px] pb-8" testId="s29-admin-notifications">
      <NotificationsCenter />
    </StaffPage>
  );
}
