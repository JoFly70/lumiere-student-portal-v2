import { BookOpen, FileText, CreditCard, HelpCircle, LogOut, User, Gauge, ShieldCheck, GraduationCap } from "lucide-react";
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
import { useHasGraduatePrograms } from "@/hooks/use-graduate-program";
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload";
import { useAuth, useAuthToken } from "@/lib/auth";
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
  { title: "Flight Deck", url: "/flight-deck", icon: Gauge },
  { title: "Student Profile", url: "/profile", icon: User },
  { title: "Your Roadmap", url: "/roadmap", icon: BookOpen },
  { title: "Documents", url: "/documents", icon: FileText },
  { title: "Billing", url: "/billing", icon: CreditCard },
  { title: "Support", url: "/support", icon: HelpCircle },
];

// Student navigation is grouped: the journey first, then the student's file.
const studentJourneyItems = studentMenuItems.filter((i) => ["/flight-deck", "/roadmap"].includes(i.url));
const studentFileItems = studentMenuItems.filter((i) => !["/flight-deck", "/roadmap"].includes(i.url));

const adminMenuItems = [
  { title: "Admin Dashboard", url: "/admin", icon: ShieldCheck },
  { title: "Support", url: "/support", icon: HelpCircle },
];

const staffMenuItems = [
  { title: "Support", url: "/support", icon: HelpCircle },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const accessToken = useAuthToken();
  const isStudent = user?.role === "student";

  const { data: profile } = useQuery({
    queryKey: ["/api/students/me", user?.id],
    queryFn: () => fetchMyProfile(accessToken),
    retry: false,
    enabled: isStudent,
  });

  // "My Master's" appears only for students with a graduate programme (hidden while loading or on error).
  const hasGraduate = useHasGraduatePrograms(isStudent);
  const journeyItems = hasGraduate ? [...studentJourneyItems, { title: "My Master's", url: "/graduate", icon: GraduationCap }] : studentJourneyItems;

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

  const portalLabel = user?.role === "admin" ? "Admin Portal" : "Student Portal";

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
              <SidebarGroupContent>{renderItems(journeyItems)}</SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-[0.16em]">Your file</SidebarGroupLabel>
              <SidebarGroupContent>{renderItems(studentFileItems)}</SidebarGroupContent>
            </SidebarGroup>
          </nav>
        </SidebarContent>
        <SidebarFooter className="gap-3 px-4 pb-5 pt-3" role="contentinfo">
          <div role="region" aria-label="Your account" className="space-y-2 rounded-xl border border-sidebar-border bg-sidebar-accent/40 p-3">
            <div className="flex items-center gap-3" aria-label="User profile" data-testid="profile-user">
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

  return (
    <Sidebar>
      <SidebarHeader className="p-6">
        <div className="flex items-center gap-3" role="region" aria-label="Lumière Higher-Ed Pathways">
          <img
            src={lumiereLogo}
            alt="Lumière Higher-Ed Pathways"
            className="h-12 w-12 object-contain"
            data-testid="img-lumiere-logo"
          />
          <div>
            <p className="text-lg font-bold leading-tight">Lumière</p>
            <p className="text-xs text-muted-foreground">Higher-Ed Pathways</p>
            <p className="text-xs text-muted-foreground">{portalLabel}</p>
          </div>
        </div>

        <div className="mt-3 border-t border-sidebar-border"></div>
        <div role="region" aria-label="Your account">
        <div
          className="mt-2 px-3 py-2 flex items-center gap-3 rounded-xl hover-elevate transition-colors"
          aria-label="User profile"
          data-testid="profile-user"
        >
          <ProfileAvatarUpload
            photoUrl={isStudent ? profile?.photo_url : undefined}
            firstName={isStudent ? profile?.first_name : user?.name?.split(" ")[0]}
            lastName={isStudent ? profile?.last_name : user?.name?.split(" ").slice(1).join(" ")}
            size="md"
            showUploadButton={false}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate" data-testid="text-username">{displayName}</div>
            <div className="text-xs text-muted-foreground truncate" data-testid="text-email">{displayEmail}</div>
          </div>
        </div>

        <button
          onClick={() => void logout()}
          className="mt-2 w-full px-3 py-2 flex items-center gap-2 text-sm rounded-xl hover-elevate transition-colors text-muted-foreground hover:text-foreground"
          data-testid="button-logout"
          aria-label="Log out"
        >
          <LogOut className="h-4 w-4" />
          <span>Log out</span>
        </button>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label="Main">
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url || (item.url === "/admin" && location.startsWith("/admin/"))}
                    data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <Link href={item.url}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarFooter className="p-6" role="contentinfo">
        <p className="text-xs text-muted-foreground text-center">© 2026 Lumière Higher-Ed Pathways</p>
      </SidebarFooter>
    </Sidebar>
  );
}
