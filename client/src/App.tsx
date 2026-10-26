import { useEffect } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/hooks/use-theme";
import { ThemeToggle } from "@/components/theme-toggle";
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
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
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
  const { user, logout } = useAuth();
  const isStudent = user?.role === "student";

  // Student-only theming of the shell. The class is on <body> so the mobile sidebar
  // sheet (a portal) is themed too; admin and staff keep the default shell.
  useEffect(() => {
    if (!isStudent) return;
    document.body.classList.add("student-shell");
    return () => document.body.classList.remove("student-shell");
  }, [isStudent]);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className={cn("flex h-dvh w-full", isStudent && "student-surface")}>
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {isStudent ? (
            // One Log out control for students: in the sidebar (and the mobile "More" menu).
            <StudentHeader />
          ) : (
            <header className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-4">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                {user && (
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {user.name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <ThemeToggle />
                {user && (
                  <Button variant="ghost" size="icon" onClick={logout} title="Logout">
                    <LogOut className="h-5 w-5" />
                  </Button>
                )}
              </div>
            </header>
          )}
          <main className={cn("flex-1 overflow-auto p-6 md:p-8", isStudent && "relative min-h-0")}>
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
