import { ReactNode } from 'react';
import { useAuth } from '@/lib/auth';
import { Redirect } from 'wouter';

type Role = 'admin' | 'coach' | 'staff' | 'student';

interface ProtectedRouteProps {
  children: ReactNode;
  requireRole?: Role | readonly Role[];
}

export function ProtectedRoute({ children, requireRole }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, user } = useAuth();

  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  // Check role requirement if specified
  const allowedRoles: readonly string[] | null = requireRole
    ? (typeof requireRole === 'string' ? [requireRole] : requireRole)
    : null;
  if (allowedRoles && !allowedRoles.includes(user?.role ?? '')) {
    // If role doesn't match, redirect to appropriate page
    if (user?.role === 'student') {
      return <Redirect to="/flight-deck" />;
    }
    if (user?.role === 'coach') {
      // No dedicated coach UI yet — route to support as a safe interim view
      return <Redirect to="/support" />;
    }
    if (user?.role === 'staff') {
      return <Redirect to="/support" />;
    }
    if (user?.role === 'admin') {
      return <Redirect to="/admin" />;
    }
    // Fallback
    return <Redirect to="/flight-deck" />;
  }

  // Render protected content
  return <>{children}</>;
}
