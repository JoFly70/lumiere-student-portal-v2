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
import { LumiereWordmark } from "@/components/brand/lumiere-brand";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { StaffAvatar } from "@/components/staff/staff-ui";
import { GlobalSearch } from "@/components/os/global-search";
import { HeaderViewAs } from "@/components/staff/header-view-as";
import { LanguageToggle } from "@/components/language-toggle";
import { useT, type TranslationKey } from "@/i18n";

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
  const { t } = useT();
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-student-seal focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-student-seal-ink"
    >
      {t("s32.shell.skip")}
    </a>
  );
}

const ROLE_LABEL: Record<string, string> = { admin: "Administrator", staff: "Staff", coach: "Coach" };
/** English role name (kept for non-React callers and tests). */
export const staffRoleLabel = (role: string | undefined): string => ROLE_LABEL[role ?? ""] ?? "Staff";
const ROLE_KEY: Record<string, TranslationKey> = { admin: "s32.role.admin", staff: "s32.role.staff", coach: "s32.role.coach" };
/** Translated role name key (S32-B). */
export const staffRoleKey = (role: string | undefined): TranslationKey => ROLE_KEY[role ?? ""] ?? "s32.role.staff";

export function StaffHeader({ name, role }: { name?: string; role?: string }) {
  const { t } = useT();
  // S32-B (SA-36): coaches cannot open student records, so the student search (which would always be empty) is hidden.
  const showSearch = role === "admin" || role === "staff";
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-student-line bg-student-bg px-3 sm:px-4" data-testid="staff-header">
      <div className="flex min-w-0 items-center gap-3">
        <SidebarTrigger className="h-10 w-10" data-testid="button-sidebar-toggle" aria-label={t("s32.shell.toggleNav")} />
        <div className="md:hidden" data-testid="text-header-brand"><LumiereWordmark variant="compact" tone="on-light" /></div>
      </div>
      {showSearch ? (
        <div className="ml-auto flex min-w-0 md:ml-0 md:flex-1 md:justify-center md:px-2" data-testid="staff-header-search">
          <GlobalSearch audience="staff" />
        </div>
      ) : <div className="flex-1" aria-hidden="true" />}
      <div className="flex min-w-0 shrink-0 items-center gap-3">
        <HeaderViewAs />
        {name && (
          <div className="hidden min-w-0 items-center gap-2.5 sm:flex" data-testid="staff-header-user">
            <StaffAvatar name={name} size="sm" />
            <p className="min-w-0 truncate text-sm font-medium text-student-ink">
              {name}
              <span className="ml-2 text-xs font-normal text-student-muted">{t(staffRoleKey(role))}</span>
            </p>
          </div>
        )}
        {/* S32-B (SA-16): staff choose EN/FR here; the choice is saved per user (LanguagePreferenceSync). */}
        <LanguageToggle />
        <ThemeToggle />
      </div>
    </header>
  );
}
