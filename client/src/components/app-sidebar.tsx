import { BookOpen, FileText, CreditCard, GraduationCap, HelpCircle, LogOut, User, Gauge, ShieldCheck, School, Sparkles, Shuffle, Library, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload";
import { useAuth, useAuthToken } from "@/lib/auth";
import { filterStudentNav, useStudentPrograms } from "@/lib/student-programs";
import { useT, type TranslationKey } from "@/i18n";
import { StaffAvatar } from "@/components/staff/staff-ui";
import { staffRoleLabel } from "@/components/staff/staff-shell";
import { ADMIN_STUDENTS_PATH } from "@/pages/admin-student-workspace-presentation";
import { LumiereCrest, BRAND } from "@/components/brand/lumiere-brand";
import { SiWhatsapp } from "react-icons/si";
import { whatsappLinkProps } from "@/components/support/whatsapp-contact";
import type { Student } from "@shared/schema";

async function fetchMyProfile(accessToken: string | null): Promise<Student | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = await fetch("/api/students/me", {
      credentials: "include",
      headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      console.log("Failed to fetch profile:", response.status);
      return null;
    }

    return response.json();
  } catch (error) {
    console.error("Error fetching profile:", error);
    return null;
  }
}

// `title` stays English (test ids, matching); `labelKey` is the visible, translated label.
const studentMenuItems: { title: string; labelKey?: TranslationKey; url: string; icon: typeof Gauge }[] = [
  { title: "High School", labelKey: "nav.highSchool", url: "/high-school", icon: School },
  { title: "Flight Deck", labelKey: "nav.flightDeck", url: "/flight-deck", icon: Gauge },
  { title: "High School Flight Deck", labelKey: "nav.highSchoolFlightDeck", url: "/high-school/flight-deck", icon: Gauge },
  { title: "Beyond the Diploma", labelKey: "s27.nav.beyondDiploma", url: "/beyond", icon: GraduationCap },
  { title: "Library", labelKey: "ux.nav.library", url: "/library", icon: Library },
  { title: "Student Profile", labelKey: "nav.profile", url: "/profile", icon: User },
  { title: "Your Roadmap", labelKey: "nav.roadmap", url: "/roadmap", icon: BookOpen },
  { title: "Documents", labelKey: "nav.documents", url: "/documents", icon: FileText },
  { title: "Billing", labelKey: "nav.billing", url: "/billing", icon: CreditCard },
  { title: "Support", labelKey: "nav.support", url: "/support", icon: HelpCircle },
];

// Student navigation is grouped: the journey first, then the student's file.
const JOURNEY_URLS = ["/high-school", "/flight-deck", "/high-school/flight-deck", "/roadmap", "/beyond", "/library"];
const studentJourneyItems = studentMenuItems.filter((i) => JOURNEY_URLS.includes(i.url));
const studentFileItems = studentMenuItems.filter((i) => !JOURNEY_URLS.includes(i.url));

// Staff navigation. "Students" opens the existing admin Students list (admin only: the
// list route is admin-gated). Staff and coaches work from the support desk.
const adminMenuItems = [
  { title: "Control Center", url: "/admin/support-center", icon: Gauge },
  { title: "Students", url: ADMIN_STUDENTS_PATH, icon: GraduationCap },
  { title: "Support desk", url: "/support", icon: HelpCircle },
  { title: "Elective requests", url: "/admin/elective-requests", icon: Shuffle },
  { title: "Lumière AI", url: "/admin/assistant", icon: Sparkles },
  { title: "Web research", url: "/admin/web-research", icon: Globe },
  { title: "Administration", url: "/admin", icon: ShieldCheck },
];

// Staff (not admin) cannot open the admin student workspace; this is their way into student billing.
export const STAFF_BILLING_PATH = "/staff/billing";

const staffMenuItems = [
  { title: "Support desk", url: "/support", icon: HelpCircle },
];
// S27: staff also get the Control Center (their allowed scope); coaches keep the support desk only.
const staffControlItem = { title: "Control Center", url: "/staff/control-center", icon: Gauge };
// Billing routes allow staff + admin only (not coach), so the entry is role-specific.
const staffBillingItem = { title: "Student billing", url: STAFF_BILLING_PATH, icon: CreditCard };
// S27: web research is for staff and admins (never coaches or students).
const staffWebItem = { title: "Web research", url: "/admin/web-research", icon: Globe };

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const accessToken = useAuthToken();
  const isStudent = user?.role === "student";
  const { t } = useT();

  const { data: profile } = useQuery({
    queryKey: ["/api/students/me", user?.id],
    queryFn: () => fetchMyProfile(accessToken),
    retry: false,
    enabled: isStudent,
  });

  // Program awareness: High School only with a high school program; Flight Deck and Roadmap are university-only.
  const programs = useStudentPrograms(isStudent);

  const menuItems =
    user?.role === "admin"
      ? adminMenuItems
      : isStudent
        ? studentMenuItems
        : user?.role === "staff"
          ? [staffControlItem, ...staffMenuItems, staffBillingItem, staffWebItem]
          : staffMenuItems;

  const displayName = isStudent && profile
    ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim() || user?.name || "User"
    : user?.name || "User";

  const displayEmail = isStudent && profile?.email
    ? profile.email
    : user?.email || "";

  // Admin, staff and coach all work in the Staff Portal; the role is shown on the account card.
  const portalLabel = isStudent ? "Student Portal" : "Staff Portal";

  if (isStudent) {
    const renderItems = (items: typeof studentMenuItems) => (
      <SidebarMenu className="gap-0.5">
        {items.map((item) => {
          const active = location === item.url;
          // "Beyond the Diploma" for high-school students, "Beyond the Bachelor's" for everyone else.
          const label = item.url === "/beyond" && !programs.hasHighSchool ? t("s27.nav.beyondBachelor") : item.labelKey ? t(item.labelKey) : item.title;
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={active}
                tooltip={label}
                className={cn(
                  "os-nav-item h-10 gap-3 rounded-lg px-3 text-[14px] font-medium text-sidebar-foreground",
                  "group-data-[collapsible=icon]:!h-10 group-data-[collapsible=icon]:!w-10 group-data-[collapsible=icon]:!justify-center group-data-[collapsible=icon]:!p-0",
                )}
                data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Link href={item.url} aria-label={label} aria-current={active ? "page" : undefined}>
                  <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  <span className="group-data-[collapsible=icon]:hidden">{label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    );
    return (
      <Sidebar collapsible="icon">
        <SidebarHeader className="px-5 pb-3 pt-6 group-data-[collapsible=icon]:px-1.5">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center" role="region" aria-label="Lumière Student Portal">
            <LumiereCrest size={44} className="group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-auto" />
            <div className="min-w-0 group-data-[collapsible=icon]:hidden" data-testid="img-lumiere-logo">
              <p className="font-display text-[26px] font-medium leading-none tracking-[0.01em] text-[var(--t-rail-head,hsl(var(--sidebar-primary)))]">{BRAND.name}</p>
              <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--t-rail-sub,hsl(var(--sidebar-foreground)/0.7))]">{BRAND.tagline}</p>
              <p className="sr-only">{portalLabel}</p>
            </div>
          </div>
          <div className="mt-5 h-px bg-sidebar-border group-data-[collapsible=icon]:mt-4" aria-hidden="true" />
        </SidebarHeader>
        <SidebarContent className="px-3 group-data-[collapsible=icon]:px-1.5">
          <nav aria-label={t("nav.main")}>
            <SidebarGroup className="px-0 py-2">
              <SidebarGroupLabel className="px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/70">{t("nav.journey")}</SidebarGroupLabel>
              <SidebarGroupContent>{renderItems(filterStudentNav(studentJourneyItems, programs))}</SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup className="px-0 py-2">
              <SidebarGroupLabel className="px-3 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/70">{t("nav.file")}</SidebarGroupLabel>
              <SidebarGroupContent>
                {renderItems(filterStudentNav(studentFileItems, programs))}
                <SidebarMenu className="mt-0.5">
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip={t("support.whatsapp.cta")}
                      className={cn(
                        "os-nav-item h-10 gap-3 rounded-lg px-3 text-[14px] font-medium text-sidebar-foreground",
                        "group-data-[collapsible=icon]:!h-10 group-data-[collapsible=icon]:!w-10 group-data-[collapsible=icon]:!justify-center group-data-[collapsible=icon]:!p-0",
                      )}
                      data-testid="link-whatsapp-sidebar"
                    >
                      <a {...whatsappLinkProps} aria-label={`${t("support.whatsapp.cta")} (${t("support.whatsapp.newTab")})`}>
                        <SiWhatsapp className="h-[18px] w-[18px] shrink-0 text-[#25D366]" aria-hidden="true" />
                        <span className="group-data-[collapsible=icon]:hidden">{t("support.whatsapp.nav")}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarFooter className="gap-3 px-3 pb-4 pt-3 group-data-[collapsible=icon]:px-1.5" role="contentinfo">
          <div
            role="region"
            aria-label={t("nav.account")}
            className="space-y-2 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0"
          >
            <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center" role="group" aria-label="User profile" data-testid="profile-user">
              <ProfileAvatarUpload
                photoUrl={profile?.photo_url}
                firstName={profile?.first_name}
                lastName={profile?.last_name}
                size="md"
                showUploadButton={false}
              />
              <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                <div className="truncate text-sm font-semibold" data-testid="text-username">{displayName}</div>
                <div className="truncate text-xs text-sidebar-foreground/70" data-testid="text-email">{displayEmail}</div>
              </div>
            </div>
            <button
              onClick={() => void logout()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-sidebar-border bg-transparent text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-10"
              data-testid="button-logout"
              aria-label={t("nav.logOut")}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="group-data-[collapsible=icon]:hidden">{t("nav.logOut")}</span>
            </button>
          </div>
          <p className="text-center text-[11px] text-sidebar-foreground/70 group-data-[collapsible=icon]:hidden">© 2026 Lumière Student Portal</p>
        </SidebarFooter>
      </Sidebar>
    );
  }

  // Which staff item is current. Students is the admin dashboard's Students tab or any workspace.
  const onStudents = location.startsWith("/admin/students");
  const isActive = (url: string) => {
    if (url === ADMIN_STUDENTS_PATH) return onStudents;
    if (url === STAFF_BILLING_PATH) return location === url || /^\/admin\/students\/[^/]+\/billing$/.test(location);
    if (url === "/admin") return location === "/admin" && !onStudents;
    return location === url;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 pb-3 pt-6 group-data-[collapsible=icon]:px-1.5">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center" role="region" aria-label="Lumière Student Portal">
          <LumiereCrest size={42} className="group-data-[collapsible=icon]:h-9 group-data-[collapsible=icon]:w-auto" />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden" data-testid="img-lumiere-logo">
            <p className="font-display text-[26px] font-medium leading-none tracking-[0.01em] text-[var(--t-rail-head,hsl(var(--sidebar-primary)))]">{BRAND.name}</p>
            <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--t-rail-sub,hsl(var(--sidebar-foreground)/0.7))]" data-testid="text-portal-label">{portalLabel}</p>
          </div>
        </div>
        <div className="mt-4 h-px bg-gradient-to-r from-sidebar-primary/60 via-sidebar-primary/20 to-transparent" aria-hidden="true" />
      </SidebarHeader>
      <SidebarContent className="px-2">
        <nav aria-label="Main">
          <SidebarGroup>
            <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.16em]">Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {menuItems.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={item.title}
                        className={cn(
                          "h-11 gap-3 rounded-lg px-3 text-[15px] font-medium group-data-[collapsible=icon]:!h-10 group-data-[collapsible=icon]:!w-10 group-data-[collapsible=icon]:!justify-center group-data-[collapsible=icon]:!p-0",
                          active && "relative bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary",
                        )}
                        data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <Link href={item.url} aria-label={item.title} aria-current={active ? "page" : undefined}>
                          <item.icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                          <span className="group-data-[collapsible=icon]:hidden">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="gap-3 px-3 pb-4 pt-2 group-data-[collapsible=icon]:px-1.5" role="contentinfo">
        <div
          role="region"
          aria-label="Your account"
          className="space-y-2 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0"
        >
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center" role="group" aria-label="User profile" data-testid="profile-user">
            <StaffAvatar name={displayName} size="lg" />
            <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <div className="truncate text-sm font-semibold" data-testid="text-username">{displayName}</div>
              <div className="truncate text-xs text-sidebar-foreground/80" data-testid="text-role">{staffRoleLabel(user?.role)}</div>
              <div className="truncate text-xs text-sidebar-foreground/70" data-testid="text-email">{displayEmail}</div>
            </div>
          </div>
          <button
            onClick={() => void logout()}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-sidebar-border bg-sidebar text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-10"
            data-testid="button-logout"
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span className="group-data-[collapsible=icon]:hidden">Log out</span>
          </button>
        </div>
        <p className="text-center text-[11px] text-sidebar-foreground group-data-[collapsible=icon]:hidden">© 2026 Lumière Student Portal</p>
      </SidebarFooter>
    </Sidebar>
  );
}
