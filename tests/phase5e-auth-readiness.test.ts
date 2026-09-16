import { describe, expect, it } from 'vitest';
import { validateProductionAuthReadiness } from '../server/lib/auth-readiness';

const validConfig = {
  appUrl: 'https://portal.example.com',
  supabaseUrl: 'https://project-ref.supabase.co',
  databaseUrl: 'postgresql://user:password@db.project-ref.supabase.co:5432/postgres',
  supabaseAnonKey: 'anon-key',
  supabaseServiceKey: 'service-key',
  sessionSecret: 'a-production-session-secret-with-32-chars',
  demoMode: false,
  authEmailMode: 'custom_smtp',
};

describe('production auth readiness', () => {
  it('passes without exposing configuration values', async () => {
    const result = await validateProductionAuthReadiness(validConfig, {
      checkTables: async () => ({ users: true, profiles: true }),
      checkAuthEmail: async () => true,
    });
    expect(result.ready).toBe(true);
    expect(JSON.stringify(result)).not.toContain('project-ref');
  });

  it('rejects insecure/local app URLs, demo mode, and missing schema probes', async () => {
    const result = await validateProductionAuthReadiness({
      ...validConfig,
      appUrl: 'http://localhost:5000',
      demoMode: true,
    });
    expect(result.ready).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      'appUrl', 'usersTable', 'profilesTable', 'demoModeDisabled', 'authEmail',
    ]));
  });

  it('requires a non-default production session secret', async () => {
    const result = await validateProductionAuthReadiness({
      ...validConfig,
      sessionSecret: 'dev-secret-change-in-production',
    }, {
      checkTables: async () => ({ users: true, profiles: true }),
      checkAuthEmail: async () => true,
    });
    expect(result.failures).toContain('sessionSecret');
  });

  it('requires a database hostname belonging to the Supabase project', async () => {
    const result = await validateProductionAuthReadiness({
      ...validConfig,
      databaseUrl: 'postgresql://user:password@db.other-project.supabase.co/postgres',
    }, {
      checkTables: async () => ({ users: true, profiles: true }),
      checkAuthEmail: async () => true,
    });
    expect(result.ready).toBe(false);
    expect(result.failures).toContain('databaseConsistency');
  });

  it('rejects a matching direct-host prefix outside Supabase', async () => {
    const result = await validateProductionAuthReadiness({
      ...validConfig,
      databaseUrl: 'postgresql://user:password@db.project-ref.attacker.example/postgres',
    }, {
      checkTables: async () => ({ users: true, profiles: true }),
      checkAuthEmail: async () => true,
    });
    expect(result.failures).toContain('databaseConsistency');
  });

  it('turns read-only probe errors into a safe failure', async () => {
    const result = await validateProductionAuthReadiness(validConfig, {
      checkTables: async () => { throw new Error('private database detail'); },
      checkAuthEmail: async () => true,
    });
    expect(result.ready).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining(['usersTable', 'profilesTable']));
    expect(JSON.stringify(result)).not.toContain('private database detail');
  });

  it('requires the email provider and allows admin-confirmed signup', async () => {
    const enabled = await validateProductionAuthReadiness(validConfig, {
      checkTables: async () => ({ users: true, profiles: true }),
      checkAuthEmail: async () => true,
    });
    expect(enabled.checks.authEmail).toBe(true);

    const disabled = await validateProductionAuthReadiness(validConfig, {
      checkTables: async () => ({ users: true, profiles: true }),
      checkAuthEmail: async () => false,
    });
    expect(disabled.failures).toContain('authEmail');
  });


  it('requires custom SMTP to be declared in production readiness', async () => {
    const probes = {
      checkTables: async () => ({ users: true, profiles: true }),
      checkAuthEmail: async () => true,
    };

    const missing = await validateProductionAuthReadiness({
      ...validConfig,
      authEmailMode: undefined,
    }, probes);
    expect(missing.ready).toBe(false);
    expect(missing.mailMode).toBe('unknown');
    expect(missing.failures).toContain('customSmtpDeclared');

    const platformDefault = await validateProductionAuthReadiness({
      ...validConfig,
      authEmailMode: 'supabase_default',
    }, probes);
    expect(platformDefault.ready).toBe(false);
    expect(platformDefault.mailMode).toBe('supabase_default');
    expect(platformDefault.failures).toContain('customSmtpDeclared');

    const custom = await validateProductionAuthReadiness(validConfig, probes);
    expect(custom.ready).toBe(true);
    expect(custom.mailMode).toBe('custom_smtp');
    expect(custom.checks.customSmtpDeclared).toBe(true);
  });

  it('fails closed when the settings probe errors', async () => {
    const result = await validateProductionAuthReadiness(validConfig, {
      checkTables: async () => ({ users: true, profiles: true }),
      checkAuthEmail: async () => { throw new Error('settings unavailable'); },
    });
    expect(result.failures).toContain('authEmail');
    expect(JSON.stringify(result)).not.toContain('settings unavailable');
  });
});