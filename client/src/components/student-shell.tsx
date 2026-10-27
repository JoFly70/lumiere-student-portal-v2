/**
 * Student app shell parts (S07): the header and the mobile bottom bar.
 * The bottom bar is a flex child under <main>, not a floating layer, so it can
 * never cover page content. Colours come from the student tokens (index.css).
 */
import { Link, useLocation } from "wouter";
import { BookOpen, FileText, Gauge, HelpCircle, Menu, School } from "lucide-react";
import { cn } from "@/lib/utils";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { filterStudentNav, useStudentPrograms } from "@/lib/student-programs";

const BAR_ITEMS = [
  { title: "High School", url: "/high-school", icon: School },
  { title: "Flight Deck", url: "/flight-deck", icon: Gauge },
  { title: "Roadmap", url: "/roadmap", icon: BookOpen },
  { title: "Documents", url: "/documents", icon: FileText },
  { title: "Support", url: "/support", icon: HelpCircle },
] as const;

export function StudentHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-student-line bg-student-card px-3 sm:px-4">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="hidden md:inline-flex" data-testid="button-sidebar-toggle" />
        <p className="font-serif text-xl tracking-tight text-student-gold-ink md:hidden" data-testid="text-header-brand">
          Lumière
        </p>
      </div>
      <ThemeToggle className="h-11 w-11" />
    </header>
  );
}

export function StudentBottomNav() {
  const [location] = useLocation();
  const { toggleSidebar } = useSidebar();
  const programs = useStudentPrograms();
  // Six tabs are too tight at 390px: a student with both programs reaches Roadmap through "More".
  const barItems = filterStudentNav(BAR_ITEMS, programs).filter((i) => !(programs.hasHighSchool && !programs.highSchoolOnly && i.url === "/roadmap"));
  const itemClass =
    "relative flex min-h-[60px] flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-tight";
  return (
    <nav
      aria-label="Primary"
      className="student-shell-bar shrink-0 border-t border-student-line bg-student-card md:hidden"
      data-testid="student-bottom-nav"
    >
      <ul className="flex">
        {barItems.map((item) => {
          const active = location === item.url;
          return (
            <li key={item.url} className="flex flex-1">
              <Link
                href={item.url}
                aria-current={active ? "page" : undefined}
                className={cn(itemClass, active ? "text-student-gold-ink" : "text-student-muted")}
                data-testid={`bar-${item.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <span
                  aria-hidden="true"
                  className={cn("flex h-7 w-12 items-center justify-center rounded-full transition-colors", active && "bg-student-gold-soft")}
                >
                  <item.icon className="h-5 w-5" />
                </span>
                {item.title}
              </Link>
            </li>
          );
        })}
        <li className="flex flex-1">
          <button type="button" onClick={toggleSidebar} className={cn(itemClass, "text-student-muted")} data-testid="bar-more">
            <span aria-hidden="true" className="flex h-7 w-12 items-center justify-center rounded-full">
              <Menu className="h-5 w-5" />
            </span>
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
