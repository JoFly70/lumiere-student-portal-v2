/**
 * Staff / admin app shell parts (S10 staff pass): the header bar, the skip link
 * and the responsive sidebar state. Colours come from the shared Lumière tokens
 * (`.staff-surface`, `body.staff-shell` in index.css), the same layer the student
 * shell uses.
 *
 * Sidebar behaviour: below 768px the sidebar is a drawer (the shared Sheet); from
 * 768px to 1279px it is a 3rem icon rail so the content keeps its width; from
 * 1280px it is open. The person can still open or close it with the trigger.
 */
import { useEffect, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { StaffAvatar } from "@/components/staff/staff-ui";

export const STAFF_SIDEBAR_OPEN_MIN_WIDTH = 1280;

/** True when the viewport is wide enough to show the full sidebar by default. */
export function useStaffSidebarDefaultOpen(): [boolean, (open: boolean) => void] {
  const query = `(min-width: ${STAFF_SIDEBAR_OPEN_MIN_WIDTH}px)`;
  const initial = () => (typeof window === "undefined" || !window.matchMedia ? true : window.matchMedia(query).matches);
  const [open, setOpen] = useState<boolean>(initial);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setOpen(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return [open, setOpen];
}

export function StaffSkipLink() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-student-seal focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-student-seal-ink"
    >
      Skip to main content
    </a>
  );
}

const ROLE_LABEL: Record<string, string> = { admin: "Administrator", staff: "Staff", coach: "Coach" };
export const staffRoleLabel = (role: string | undefined): string => ROLE_LABEL[role ?? ""] ?? "Staff";

export function StaffHeader({ name, role }: { name?: string; role?: string }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-student-line bg-student-bg px-3 sm:px-4" data-testid="staff-header">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger className="h-10 w-10" data-testid="button-sidebar-toggle" aria-label="Toggle navigation" />
        <p className="font-serif text-xl tracking-tight text-student-gold-ink md:hidden" data-testid="text-header-brand">Lumière</p>
        <p className="hidden text-[11px] font-semibold uppercase tracking-[0.18em] text-student-muted md:block">Staff Portal</p>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {name && (
          <div className="hidden min-w-0 items-center gap-2.5 sm:flex" data-testid="staff-header-user">
            <StaffAvatar name={name} size="sm" />
            <p className="min-w-0 truncate text-sm font-medium text-student-ink">
              {name}
              <span className="ml-2 text-xs font-normal text-student-muted">{staffRoleLabel(role)}</span>
            </p>
          </div>
        )}
        <ThemeToggle />
      </div>
    </header>
  );
}
