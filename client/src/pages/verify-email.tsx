import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { useT } from '@/i18n';
import { AuthLayout } from '@/components/auth/auth-layout';
import { AuthStatus } from '@/components/auth/auth-parts';
import { parseVerificationLink, verificationUrlWithoutCredentials, type VerificationLink } from '@/lib/verification-link';

type Status = 'verifying' | 'success' | 'expired' | 'invalid' | 'missing' | 'unavailable';

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const { t } = useT();
  // Read once; the credential lives only in this ref and the request body.
  const link = useRef<VerificationLink | null>(null);
  if (link.current === null) link.current = parseVerificationLink(window.location.href);
  const [status, setStatus] = useState<Status>(() => {
    const l = link.current!;
    if (l.kind === 'missing') return 'missing';
    if (l.kind === 'error') return l.reason;
    return 'verifying';
  });

  // Strip the credential from the URL/history before anything renders.
  useLayoutEffect(() => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const clean = verificationUrlWithoutCredentials(window.location.href);
    if (clean !== current) window.history.replaceState(null, '', clean);
  }, []);

  useEffect(() => {
    const l = link.current;
    if (!l || l.kind !== 'credential') return;
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: l.accessToken, token_hash: l.tokenHash, type: l.type }),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data?.verified === true) setStatus('success');
        else if (response.status === 401) setStatus('expired');
        else if (response.status === 400) setStatus('invalid');
        else setStatus('unavailable');
      } catch (error) {
        if ((error as { name?: string })?.name !== 'AbortError') setStatus('unavailable');
      } finally {
        link.current = { kind: 'missing' }; // drop the credential from memory
      }
    })();
    return () => controller.abort();
  }, []);

  const bodyKey = {
    expired: 'auth.verify.expiredBody',
    invalid: 'auth.verify.errorBody',
    missing: 'auth.verify.missingBody',
    unavailable: 'auth.verify.unavailableBody',
  } as const;

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
        {status !== 'verifying' && status !== 'success' && (
          <AuthStatus
            tone="error"
            icon={status === 'expired' ? <Clock size={30} /> : <XCircle size={30} />}
            title={t(status === 'expired' ? 'auth.verify.expiredTitle' : 'auth.verify.errorTitle')}
          >
            <p className="auth-sub" style={{ margin: 0 }} role="alert">{t(bodyKey[status])}</p>
            <button type="button" className="auth-btn auth-btn-quiet" onClick={() => setLocation('/login')} data-testid="button-back-login">
              {t('auth.backToSignin')}
            </button>
            <p className="auth-hint">
              {t('auth.verify.noEmail')}{' '}
              <button type="button" className="auth-link" onClick={() => setLocation('/resend-verification')} data-testid="link-resend-verification">
                {t('auth.verify.resend')}
              </button>
            </p>
          </AuthStatus>
        )}
      </div>
    </AuthLayout>
  );
}
