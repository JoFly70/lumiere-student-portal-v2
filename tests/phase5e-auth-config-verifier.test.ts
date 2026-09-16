import { describe, expect, it } from 'vitest';
import { checkSupabaseAuthConfig } from '../server/lib/supabase-auth-config-check';

const appUrl = 'https://lumiere-student-portal-v-2.replit.app';

const goodConfig = {
  site_url: appUrl + '/',
  uri_allow_list: `https://example.com, ${appUrl}/reset-password`,
  smtp_host: 'smtp.resend.com',
  smtp_port: 465,
  smtp_user: 'resend',
  smtp_admin_email: 'no-reply@auth.lumierepathways.com',
  smtp_sender_name: 'Lumière',
  smtp_pass: 'must-never-leak',
};

describe('Supabase auth config verifier', () => {
  it('passes for the expected site URL, reset allowlist, and custom SMTP', () => {
    const result = checkSupabaseAuthConfig(goodConfig, appUrl);

    expect(result.ok).toBe(true);
    expect(result.siteUrlMatch).toBe(true);
    expect(result.resetRedirectPresent).toBe(true);
    expect(result.smtpMode).toBe('custom_smtp');
    expect(result.smtpHost).toBe('smtp.resend.com');
    expect(result.smtpSenderEmail).toBe('no-reply@auth.lumierepathways.com');
  });

  it('fails when the configured Site URL does not match APP_URL', () => {
    const result = checkSupabaseAuthConfig({
      ...goodConfig,
      site_url: 'https://wrong.example.com',
    }, appUrl);

    expect(result.ok).toBe(false);
    expect(result.siteUrlMatch).toBe(false);
    expect(result.failures).toContain('siteUrl');
  });

  it('fails when the reset-password redirect is missing from the allowlist', () => {
    const result = checkSupabaseAuthConfig({
      ...goodConfig,
      uri_allow_list: ['https://example.com/other'],
    }, appUrl);

    expect(result.ok).toBe(false);
    expect(result.resetRedirectPresent).toBe(false);
    expect(result.failures).toContain('resetRedirect');
  });

  it('reports Supabase default mail when custom SMTP fields are absent', () => {
    const result = checkSupabaseAuthConfig({
      site_url: appUrl,
      uri_allow_list: [`${appUrl}/reset-password`],
    }, appUrl);

    expect(result.ok).toBe(false);
    expect(result.smtpMode).toBe('supabase_default');
    expect(result.failures).toContain('customSmtp');
  });

  it('never includes SMTP passwords in the safe report', () => {
    const result = checkSupabaseAuthConfig(goodConfig, appUrl);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('must-never-leak');
    expect(serialized).not.toContain('smtp_pass');
  });
});
