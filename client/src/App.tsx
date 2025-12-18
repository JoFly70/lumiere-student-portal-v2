import { Switch, Route, Redirect } from "wouter";
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

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/auth/verify" component={VerifyEmail} />
      <Route path="/">{() => <Redirect to="/flight-deck" />}</Route>
      <Route path="/dashboard">{() => <Redirect to="/flight-deck" />}</Route>
      <Route path="/admin">{() => <Redirect to="/support" />}</Route>

      <Route path="/flight-deck">
        {() => (
          <ProtectedRoute>
            <FlightDeck />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/profile">
        {() => (
          <ProtectedRoute>
            <StudentProfile />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/roadmap">
        {() => (
          <ProtectedRoute>
            <Roadmap />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/documents">
        {() => (
          <ProtectedRoute>
            <Documents />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/billing">
        {() => (
          <ProtectedRoute>
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

      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const { user, logout } = useAuth();

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1">
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
          <main className="flex-1 overflow-auto p-6 md:p-8">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider>
          <TooltipProvider>
            <AuthenticatedLayout />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
