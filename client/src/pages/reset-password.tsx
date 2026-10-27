import { useLayoutEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { CheckCircle2, MailCheck } from 'lucide-react';
import { useT } from '@/i18n';
import { AuthLayout } from '@/components/auth/auth-layout';
import { AuthAlert, AuthField, AuthHeading, AuthStatus, AuthSubmit } from '@/components/auth/auth-parts';
import { parseRecoveryLink, recoveryUrlWithoutCredentials } from '@/lib/recovery-token';

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { t } = useT();
  // Read once; the credential lives only in this state and the request body.
  const [link] = useState(() => parseRecoveryLink(window.location.href));
  const recoveryToken = link.kind === 'access_token' ? link.accessToken : null;
  const recoveryTokenHash = link.kind === 'token_hash' ? link.tokenHash : null;
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  // An unusable link lands on the request-a-new-link form with an explanation.
  const [error, setError] = useState(() =>
    link.kind === 'unsupported' ? t('auth.reset.linkUnsupported')
      : link.kind === 'error' ? t(link.reason === 'expired' ? 'auth.reset.linkExpired' : 'auth.reset.linkUnsupported')
      : '');
  const [success, setSuccess] = useState(false);

  useLayoutEffect(() => {
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const cleanUrl = recoveryUrlWithoutCredentials(window.location.href);
    if (cleanUrl !== currentUrl) {
      window.history.replaceState(null, '', cleanUrl);
    }
  }, []);

  const isRecoveryMode = !!recoveryToken || !!recoveryTokenHash;

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('auth.reset.failed'));
      }

      setSuccess(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('auth.reset.failed'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError(t('auth.newPassword.tooShort'));
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: newPassword,
          ...(recoveryToken ? { access_token: recoveryToken } : { token_hash: recoveryTokenHash }),
          recovery_type: 'recovery',
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || t('auth.newPassword.failed'));
      }

      setSuccess(true);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('auth.newPassword.failed'));
    } finally {
      setLoading(false);
    }
  };

  const goLogin = (e: React.MouseEvent) => {
    e.preventDefault();
    setLocation('/login');
  };
  const backLink = (
    <a href="/login" className="auth-link" onClick={goLogin} data-testid="link-back-login">
      {t('auth.backToSignin')}
    </a>
  );

  let body: React.ReactNode;
  if (success) {
    body = (
      <AuthStatus
        icon={isRecoveryMode ? <CheckCircle2 size={30} /> : <MailCheck size={30} />}
        title={isRecoveryMode ? t('auth.newPassword.doneTitle') : t('auth.reset.sentTitle')}
      >
        <div data-testid={isRecoveryMode ? 'text-password-updated' : 'text-reset-sent'} className="auth-sub" style={{ margin: 0 }}>
          {isRecoveryMode ? (
            <p style={{ margin: 0 }}>{t('auth.newPassword.doneBody')}</p>
          ) : (
            <>
              <p style={{ margin: 0 }}>{t('auth.reset.sentBody', { email })}</p>
              <p className="auth-hint" style={{ marginTop: 6 }}>{t('auth.reset.sentExpiry')}</p>
            </>
          )}
        </div>
        <button type="button" className="auth-btn auth-btn-quiet" onClick={() => setLocation('/login')} data-testid="button-back-login">
          {t('auth.backToSignin')}
        </button>
      </AuthStatus>
    );
  } else if (isRecoveryMode) {
    body = (
      <div className="auth-main">
        <AuthHeading title={t('auth.newPassword.title')} subtitle={t('auth.newPassword.subtitle')} />
        <form onSubmit={handlePasswordUpdate} className="auth-form auth-rise" style={{ ['--d' as string]: '100ms' }}>
          <AuthField
            id="new-password" name="new-password" password label={t('auth.newPassword.label')} placeholder={t('auth.newPassword.placeholder')}
            hint={t('auth.field.passwordHint')} value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            required minLength={6} autoComplete="new-password" testId="input-new-password"
          />
          {error && <AuthAlert testId="text-reset-error">{error}</AuthAlert>}
          <AuthSubmit loading={loading} label={t('auth.newPassword.submit')} loadingLabel={t('auth.newPassword.loading')} testId="button-update-password" />
        </form>
      </div>
    );
  } else {
    body = (
      <div className="auth-main">
        <AuthHeading title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')} />
        <form onSubmit={handleEmailSubmit} className="auth-form auth-rise" style={{ ['--d' as string]: '100ms' }}>
          <AuthField
            id="email" name="email" type="email" label={t('auth.field.email')} placeholder={t('auth.field.emailPlaceholder')}
            value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" testId="input-reset-email"
          />
          {error && <AuthAlert testId="text-reset-error">{error}</AuthAlert>}
          <AuthSubmit loading={loading} label={t('auth.reset.submit')} loadingLabel={t('auth.reset.loading')} testId="button-send-reset" />
        </form>
        <div className="auth-foot">{backLink}</div>
      </div>
    );
  }

  return <AuthLayout>{body}</AuthLayout>;
}
