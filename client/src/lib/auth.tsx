import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useLocation } from 'wouter';
import { isRestorableAuthState, publishAuthLifecycle } from './auth-lifecycle';

interface User {
  id: string;
  email: string;
  name: string;
  role?: string;
}

interface AuthSession {
  access_token: string;
  refresh_token?: string | null;
  expires_at: number;
  csrf_token?: string;
}

interface AuthContextType {
  user: User | null;
  session: AuthSession | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AUTH_STORAGE_KEY = 'lumiere_auth';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const identityRef = useRef<string | null>(null);
  const [, setLocation] = useLocation();

  const publishAuthState = (nextUser: User | null, nextSession: AuthSession | null) => {
    identityRef.current = publishAuthLifecycle(
      identityRef.current,
      nextUser,
      nextSession,
      () => {
        setUser(nextUser);
        setSession(nextSession);
      },
    );
  };

  // Load stored session on mount
  useEffect(() => {
    const loadStoredSession = () => {
      let nextUser: User | null = null;
      let nextSession: AuthSession | null = null;

      try {
        const stored = localStorage.getItem(AUTH_STORAGE_KEY);
        if (stored) {
          const data = JSON.parse(stored);

          if (isRestorableAuthState(data)) {
            nextUser = data.user;
            nextSession = data.session;
          } else {
            // Session is expired or malformed, clear storage.
            localStorage.removeItem(AUTH_STORAGE_KEY);
          }
        }
      } catch (error) {
        console.error('Failed to load stored session:', error);
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } finally {
        publishAuthState(nextUser, nextSession);
        setIsLoading(false);
      }
    };

    loadStoredSession();
  }, []);

  // Store session when it changes.
  useEffect(() => {
    if (user && session) {
      try {
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user, session }));
      } catch (error) {
        console.error('Failed to store session:', error);
      }
    }
  }, [user, session]);

  const login = async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Login failed');
    }

    const data = await response.json();

    // Fetch CSRF token after successful login
    const csrfResponse = await fetch('/api/csrf-token', {
      headers: {
        'Authorization': `Bearer ${data.session.access_token}`,
      },
    });

    let csrfToken: string | undefined;
    if (csrfResponse.ok) {
      const csrfData = await csrfResponse.json();
      csrfToken = csrfData.csrfToken;
    }

    publishAuthState(data.user, {
      ...data.session,
      csrf_token: csrfToken,
    });
  };

  const signup = async (email: string, password: string, fullName: string) => {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, fullName }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Sign-up failed');
    }

    const data = await response.json();

    // Check if email verification is required
    if (data.emailVerificationRequired) {
      throw new Error(data.message || 'Please check your email to verify your account');
    }

    // If auto-login succeeded, set session and fetch CSRF token
    if (data.session) {
      const csrfResponse = await fetch('/api/csrf-token', {
        headers: {
          'Authorization': `Bearer ${data.session.access_token}`,
        },
      });

      let csrfToken: string | undefined;
      if (csrfResponse.ok) {
        const csrfData = await csrfResponse.json();
        csrfToken = csrfData.csrfToken;
      }

      publishAuthState(data.user, {
        ...data.session,
        csrf_token: csrfToken,
      });
    }
  };

  const logout = async () => {
    try {
      // Call logout endpoint to clear CSRF token on server before local auth state.
      if (session?.access_token && session?.csrf_token) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'X-CSRF-Token': session.csrf_token,
          },
        });
      }
    } catch (error) {
      console.error('Logout request failed:', error);
    } finally {
      publishAuthState(null, null);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      setLocation('/login');
    }
  };

  const value: AuthContextType = {
    user,
    session,
    isLoading,
    login,
    signup,
    logout,
    isAuthenticated: !!user && !!session,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Hook to get auth token for API calls
export function useAuthToken() {
  const { session } = useAuth();
  return session?.access_token || null;
}

// Hook to create authenticated fetch
export function useAuthFetch() {
  const token = useAuthToken();

  return async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    if (options.body && typeof options.body === 'object') {
      headers.set('Content-Type', 'application/json');
    }

    return fetch(url, {
      ...options,
      headers,
    });
  };
}
