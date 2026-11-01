import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/lib/auth';
import { isLanguage, useLanguage, useT } from '@/i18n';
import { LoginView, parseInviteCode } from '@/components/auth/login-view';
import { takeReturnPath } from '@/lib/return-to';
import { roleHomePath } from '@shared/staff-links';

export default function Login() {
  const [, setLocation] = useLocation();
  const { login, signup, isAuthenticated, user } = useAuth();
  const { t } = useT();
  const { language, setLanguage } = useLanguage();
  // Account creation is invitation-only; an invite link carries ?invite=<code>.
  const expired = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('expired') === '1';
  const initialInvite = typeof window === 'undefined' ? '' : parseInviteCode(window.location.search);

  // Invitation emails carry ?lang=en|fr so the page opens in the invitee's language.
  useEffect(() => {
    const requested = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('lang');
    if (isLanguage(requested) && requested !== language) setLanguage(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect if already authenticated: the page the person opened before signing in (S32-B, when their role may open
  // it), otherwise the role home (admin: Control Center; staff: staff Control Center; coach: support desk).
  useEffect(() => {
    if (isAuthenticated) {
      setLocation(takeReturnPath(user?.role) ?? roleHomePath(user?.role));
    }
  }, [isAuthenticated, user, setLocation]);

  if (isAuthenticated) return <p className="sr-only" role="status">{t('auth.redirecting')}</p>;

  return <LoginView login={login} signup={signup} onNavigate={setLocation} initialInvite={initialInvite} notice={expired ? t('auth.sessionExpired') : undefined} />;
}
