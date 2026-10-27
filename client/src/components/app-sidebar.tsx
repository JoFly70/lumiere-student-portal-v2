import { BookOpen, FileText, CreditCard, GraduationCap, HelpCircle, LogOut, User, Gauge, ShieldCheck, School } from "lucide-react";
import { cn } from "@/lib/utils";
import { Link, useLocation, useSearch } from "wouter";
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
import { StaffAvatar } from "@/components/staff/staff-ui";
import { staffRoleLabel } from "@/components/staff/staff-shell";
import { ADMIN_STUDENTS_PATH, adminTabFromSearch } from "@/pages/admin-student-workspace-presentation";
import lumiereLogo from "@assets/Lumiere Logo_1762534146530.webp";
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

const studentMenuItems = [
  { title: "High School", url: "/high-school", icon: School },
  { title: "Flight Deck", url: "/flight-deck", icon: Gauge },
  { title: "Student Profile", url: "/profile", icon: User },
  { title: "Your Roadmap", url: "/roadmap", icon: BookOpen },
  { title: "Documents", url: "/documents", icon: FileText },
  { title: "Billing", url: "/billing", icon: CreditCard },
  { title: "Support", url: "/support", icon: HelpCircle },
];

// Student navigation is grouped: the journey first, then the student's file.
const JOURNEY_URLS = ["/high-school", "/flight-deck", "/roadmap"];
const studentJourneyItems = studentMenuItems.filter((i) => JOURNEY_URLS.includes(i.url));
const studentFileItems = studentMenuItems.filter((i) => !JOURNEY_URLS.includes(i.url));

// Staff navigation. "Students" opens the existing admin Students list (admin only: the
// list route is admin-gated). Staff and coaches work from the support desk.
const adminMenuItems = [
  { title: "Admin Dashboard", url: "/admin", icon: ShieldCheck },
  { title: "Students", url: ADMIN_STUDENTS_PATH, icon: GraduationCap },
  { title: "Support", url: "/support", icon: HelpCircle },
];

const staffMenuItems = [
  { title: "Support", url: "/support", icon: HelpCircle },
];

export function AppSidebar() {
  const [location] = useLocation();
  const search = useSearch();
  const { user, logout } = useAuth();
  const accessToken = useAuthToken();
  const isStudent = user?.role === "student";

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
      <SidebarMenu>
        {items.map((item) => {
          const active = location === item.url;
          return (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                isActive={active}
                className={cn(
                  "h-11 gap-3 rounded-lg px-3 text-[15px] font-medium",
                  active && "relative bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-sidebar-primary",
                )}
                data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Link href={item.url} aria-current={active ? "page" : undefined}>
                  <item.icon className="h-[18px] w-[18px]" aria-hidden="true" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    );
    return (
      <Sidebar>
        <SidebarHeader className="px-6 pb-4 pt-7">
          <div className="flex items-center gap-3" role="region" aria-label="Lumière Higher-Ed Pathways">
            <img src={lumiereLogo} alt="Lumière Higher-Ed Pathways" className="h-11 w-11 object-contain" data-testid="img-lumiere-logo" />
            <div>
              <p className="font-serif text-2xl leading-none tracking-tight text-sidebar-primary">Lumière</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/70">Higher-Ed Pathways</p>
              <p className="sr-only">{portalLabel}</p>
            </div>
          </div>
          <div className="mt-5 h-px bg-gradient-to-r from-sidebar-primary/60 via-sidebar-primary/20 to-transparent" aria-hidden="true" />
        </SidebarHeader>
        <SidebarContent className="px-2">
          <nav aria-label="Main">
            <SidebarGroup>
              <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.16em]">Your journey</SidebarGroupLabel>
              <SidebarGroupContent>{renderItems(filterStudentNav(studentJourneyItems, programs))}</SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.16em]">Your file</SidebarGroupLabel>
              <SidebarGroupContent>{renderItems(filterStudentNav(studentFileItems, programs))}</SidebarGroupContent>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarFooter className="gap-3 px-4 pb-5 pt-3" role="contentinfo">
          <div role="region" aria-label="Your account" className="space-y-2 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3">
            <div className="flex items-center gap-3" role="group" aria-label="User profile" data-testid="profile-user">
              <ProfileAvatarUpload
                photoUrl={profile?.photo_url}
                firstName={profile?.first_name}
                lastName={profile?.last_name}
                size="md"
                showUploadButton={false}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold" data-testid="text-username">{displayName}</div>
                <div className="truncate text-xs text-sidebar-foreground/70" data-testid="text-email">{displayEmail}</div>
              </div>
            </div>
            <button
              onClick={() => void logout()}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-sidebar-border bg-sidebar text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent"
              data-testid="button-logout"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Log out</span>
            </button>
          </div>
          <p className="text-center text-[11px] text-sidebar-foreground">© 2026 Lumière Higher-Ed Pathways</p>
        </SidebarFooter>
      </Sidebar>
    );
  }

  // Which staff item is current. Students is the admin dashboard's Students tab or any workspace.
  const onStudents = location.startsWith("/admin/students") || (location === "/admin" && adminTabFromSearch(search) === "students");
  const isActive = (url: string) => {
    if (url === ADMIN_STUDENTS_PATH) return onStudents;
    if (url === "/admin") return location.startsWith("/admin") && !onStudents;
    return location === url;
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 pb-3 pt-6 group-data-[collapsible=icon]:px-1.5">
        <div className="flex items-center gap-3 group-data-[collapsible=icon]:justify-center" role="region" aria-label="Lumière Higher-Ed Pathways">
          <img
            src={lumiereLogo}
            alt="Lumière Higher-Ed Pathways"
            className="h-10 w-10 shrink-0 object-contain"
            data-testid="img-lumiere-logo"
          />
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="font-serif text-2xl leading-none tracking-tight text-sidebar-primary">Lumière</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/70">Higher-Ed Pathways</p>
            <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-sidebar-primary" data-testid="text-portal-label">{portalLabel}</p>
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
        <p className="text-center text-[11px] text-sidebar-foreground group-data-[collapsible=icon]:hidden">© 2026 Lumière Higher-Ed Pathways</p>
      </SidebarFooter>
    </Sidebar>
  );
}
