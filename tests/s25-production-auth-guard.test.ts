import { describe, expect, it } from 'vitest';
import { assertProductionAuthPolicy, productionAuthPolicyProblems } from '../server/lib/production-auth-guard';

describe('S25 production auth startup guard', () => {
  it('is inert outside production', () => {
    expect(productionAuthPolicyProblems({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toEqual([]);
    expect(productionAuthPolicyProblems({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it('refuses production without ENABLE_EMAIL_VERIFICATION=true', () => {
    expect(() => assertProductionAuthPolicy({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/ENABLE_EMAIL_VERIFICATION/);
    expect(() => assertProductionAuthPolicy({ NODE_ENV: 'production', ENABLE_EMAIL_VERIFICATION: 'false' } as NodeJS.ProcessEnv)).toThrow(/ENABLE_EMAIL_VERIFICATION/);
    expect(() => assertProductionAuthPolicy({ NODE_ENV: 'production', ENABLE_EMAIL_VERIFICATION: 'TRUE' } as NodeJS.ProcessEnv)).toThrow();
  });

  it('refuses production demo mode even with verification on', () => {
    expect(() => assertProductionAuthPolicy({ NODE_ENV: 'production', ENABLE_EMAIL_VERIFICATION: 'true', ALLOW_DEMO_MODE: 'true' } as NodeJS.ProcessEnv)).toThrow(/ALLOW_DEMO_MODE/);
  });

  it('accepts a compliant production environment and never echoes values', () => {
    expect(() => assertProductionAuthPolicy({ NODE_ENV: 'production', ENABLE_EMAIL_VERIFICATION: 'true' } as NodeJS.ProcessEnv)).not.toThrow();
    try {
      assertProductionAuthPolicy({ NODE_ENV: 'production', SESSION_SECRET: 'super-secret-value', ALLOW_DEMO_MODE: 'true' } as NodeJS.ProcessEnv);
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('super-secret-value');
    }
  });
});
