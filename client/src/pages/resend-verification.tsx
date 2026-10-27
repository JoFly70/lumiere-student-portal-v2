import { useState } from 'react';
import { useLocation } from 'wouter';
import { MailCheck } from 'lucide-react';
import { useT } from '@/i18n';
import { AuthLayout } from '@/components/auth/auth-layout';
import { AuthAlert, AuthField, AuthHeading, AuthStatus, AuthSubmit } from '@/components/auth/auth-parts';

export default function ResendVerification() {
  const [, setLocation] = useLocation();
  const { t } = useT();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (response.status === 429) throw new Error(t('auth.resendVerification.tooMany'));
      if (!response.ok) throw new Error(t('auth.resendVerification.failed'));
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.resendVerification.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      {sent ? (
        <AuthStatus icon={<MailCheck size={30} />} title={t('auth.resendVerification.sentTitle')}>
          <p className="auth-sub" style={{ margin: 0 }} data-testid="text-resend-sent">{t('auth.resendVerification.sentBody')}</p>
          <button type="button" className="auth-btn auth-btn-quiet" onClick={() => setLocation('/login')} data-testid="button-back-login">
            {t('auth.backToSignin')}
          </button>
        </AuthStatus>
      ) : (
        <div className="auth-main">
          <AuthHeading title={t('auth.resendVerification.title')} subtitle={t('auth.resendVerification.subtitle')} />
          <form onSubmit={submit} className="auth-form auth-rise" style={{ ['--d' as string]: '100ms' }}>
            <AuthField
              id="email" name="email" type="email" label={t('auth.field.email')} placeholder={t('auth.field.emailPlaceholder')}
              value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" testId="input-resend-email"
            />
            {error && <AuthAlert testId="text-resend-error">{error}</AuthAlert>}
            <AuthSubmit loading={loading} label={t('auth.resendVerification.submit')} loadingLabel={t('auth.resendVerification.loading')} testId="button-resend-verification" />
          </form>
          <div className="auth-foot">
            <a href="/login" className="auth-link" onClick={(e) => { e.preventDefault(); setLocation('/login'); }}>{t('auth.backToSignin')}</a>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
