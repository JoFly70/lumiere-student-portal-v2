import { useEffect } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/hooks/use-theme";
import { StaffHeader, StaffSkipLink, useStaffSidebarDefaultOpen } from "@/components/staff/staff-shell";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "@/pages/login";
import ResetPassword from "@/pages/reset-password";
import VerifyEmail from "@/pages/verify-email";
import StudentProfile from "@/pages/student-profile";
import FlightDeck from "@/pages/flight-deck";
import Roadmap from "@/pages/roadmap";
import Documents from "@/pages/documents";
import Billing from "@/pages/billing";
import Support from "@/pages/support";
import NotFound from "@/pages/not-found";
import { StudentBottomNav, StudentHeader } from "@/components/student-shell";
import { cn } from "@/lib/utils";
import Admin from "@/pages/admin";
import AdminStudentWorkspace from "@/pages/admin-student-workspace";
import AdminStudentRoadmap from "@/pages/admin-student-roadmap";

function RoleLanding() {
  const { user, isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  if (user?.role === "admin") {
    return <Redirect to="/admin" />;
  }

  if (user?.role === "coach" || user?.role === "staff") {
    return <Redirect to="/support" />;
  }

  return <Redirect to="/flight-deck" />;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/auth/verify" component={VerifyEmail} />
      <Route path="/">{() => <RoleLanding />}</Route>
      <Route path="/dashboard">{() => <RoleLanding />}</Route>

      <Route path="/admin">
        {() => (
          <ProtectedRoute requireRole="admin">
            <Admin />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/students/:studentId/roadmap">
        {() => (
          <ProtectedRoute requireRole={["admin", "staff"]}>
            <AdminStudentRoadmap />
          </ProtectedRoute>
        )}
      </Route>
      <Route path="/admin/students/:studentId">
        {() => (
          <ProtectedRoute requireRole="admin">
            <AdminStudentWorkspace />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/flight-deck">
        {() => (
          <ProtectedRoute requireRole="student">
            <FlightDeck />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/profile">
        {() => (
          <ProtectedRoute requireRole="student">
            <StudentProfile />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/roadmap">
        {() => (
          <ProtectedRoute requireRole="student">
            <Roadmap />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/documents">
        {() => (
          <ProtectedRoute requireRole="student">
            <Documents />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/billing">
        {() => (
          <ProtectedRoute requireRole="student">
            <Billing />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/support">
        {() => (
          <ProtectedRoute>
            <Support />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/coach-dashboard">{() => <Redirect to="/support" />}</Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { user } = useAuth();
  const isStudent = user?.role === "student";
  // Staff, coach and admin share the Lumière staff shell; students keep their own.
  const isStaffShell = !!user && !isStudent;
  const [staffSidebarOpen, setStaffSidebarOpen] = useStaffSidebarDefaultOpen();

  // Role-scoped theming of the shell. The class is on <body> so the mobile sidebar
  // sheet and dialogs (portals) are themed too.
  useEffect(() => {
    if (!isStudent) return;
    document.body.classList.add("student-shell");
    return () => document.body.classList.remove("student-shell");
  }, [isStudent]);
  useEffect(() => {
    if (!isStaffShell) return;
    document.body.classList.add("staff-shell");
    return () => document.body.classList.remove("staff-shell");
  }, [isStaffShell]);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider
      style={style as React.CSSProperties}
      {...(isStaffShell ? { open: staffSidebarOpen, onOpenChange: setStaffSidebarOpen } : {})}
    >
      <div className={cn("flex h-dvh w-full", isStudent && "student-surface", isStaffShell && "staff-surface")}>
        {isStaffShell && <StaffSkipLink />}
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {isStudent ? (
            // One Log out control for students: in the sidebar (and the mobile "More" menu).
            <StudentHeader />
          ) : (
            <StaffHeader name={user?.name} role={user?.role} />
          )}
          <main
            {...(isStudent ? {} : { id: "main-content", tabIndex: -1 })}
            className={cn(
              "flex-1 overflow-auto",
              isStudent ? "relative min-h-0 p-6 md:p-8" : "p-4 focus-visible:outline-none sm:p-6 lg:p-8",
            )}
          >
            <Router />
          </main>
          {isStudent && <StudentBottomNav />}
        </div>
      </div>
    </SidebarProvider>
  );
}

function ApplicationLayout() {
  const [location] = useLocation();
  const isAuthRoute =
    location === "/login" ||
    location === "/reset-password" ||
    location === "/auth/verify";

  if (isAuthRoute) {
    return <Router />;
  }

  return <AuthenticatedLayout />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <TooltipProvider>
            <ApplicationLayout />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
