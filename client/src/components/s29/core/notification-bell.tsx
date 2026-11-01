/** S29: student header bell with the unread count; links to /notifications. Quietly hidden while S29 is off. */
import { Link } from "wouter";
import { Bell } from "lucide-react";
import { useT } from "@/i18n";
import { useInbox, isS29Unavailable } from "@/lib/s29-core-queries";

export function NotificationBell() {
  const { t } = useT();
  const inbox = useInbox();
  if (inbox.isError && isS29Unavailable(inbox.error)) return null;
  const unread = inbox.data?.unread ?? 0;
  const label = unread > 0 ? t("s29.core.bell.unread", { n: unread }) : t("s29.core.bell.label");
  return (
    <Link href="/notifications" aria-label={label} title={label} data-testid="notification-bell"
      className="relative inline-flex h-11 w-11 items-center justify-center rounded-full text-student-ink hover:bg-student-gold-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-student-gold">
      <Bell className="h-5 w-5" aria-hidden="true" />
      {unread > 0 ? (
        <span data-testid="notification-bell-count" aria-hidden="true"
          className="absolute right-1.5 top-1.5 min-w-[1.125rem] rounded-full bg-student-gold-bright px-1 text-center text-[0.6875rem] font-semibold leading-[1.125rem] text-student-gold-bright-ink">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
