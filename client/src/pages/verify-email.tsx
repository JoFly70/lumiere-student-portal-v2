import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useT } from '@/i18n';
import { AuthLayout } from '@/components/auth/auth-layout';
import { AuthStatus } from '@/components/auth/auth-parts';

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const { t } = useT();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');

  useEffect(() => {
    // The verification token arrives in the URL hash.
    const hash = window.location.hash;

    if (!hash || !hash.includes('access_token')) {
      setStatus('error');
      return;
    }

    // Supabase handles verification automatically via the link; the hash confirms it.
    const timer = setTimeout(() => setStatus('success'), 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <AuthLayout>
      <div aria-live="polite" data-testid={`verify-${status}`}>
        {status === 'verifying' && (
          <AuthStatus icon={<Loader2 size={30} className="auth-spin" />} title={t('auth.verify.pendingTitle')}>
            <p className="auth-sub" style={{ margin: 0 }}>{t('auth.verify.pendingBody')}</p>
          </AuthStatus>
        )}
        {status === 'success' && (
          <AuthStatus icon={<CheckCircle2 size={30} />} title={t('auth.verify.successTitle')}>
            <p className="auth-sub" style={{ margin: 0 }}>{t('auth.verify.successBody')}</p>
            <button type="button" className="auth-btn" onClick={() => setLocation('/login')} data-testid="button-go-login">
              {t('auth.verify.goToSignin')}
            </button>
          </AuthStatus>
        )}
        {status === 'error' && (
          <AuthStatus tone="error" icon={<XCircle size={30} />} title={t('auth.verify.errorTitle')}>
            <p className="auth-sub" style={{ margin: 0 }} role="alert">{t('auth.verify.errorBody')}</p>
            <button type="button" className="auth-btn auth-btn-quiet" onClick={() => setLocation('/login')} data-testid="button-back-login">
              {t('auth.backToSignin')}
            </button>
            <p className="auth-hint">
              {t('auth.verify.noEmail')}{' '}
              <button type="button" className="auth-link" onClick={() => setLocation('/resend-verification')}>
                {t('auth.verify.resend')}
              </button>
            </p>
          </AuthStatus>
        )}
      </div>
    </AuthLayout>
  );
}
