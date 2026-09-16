import { describe, expect, it } from 'vitest';
import {
  extractRecoveryToken,
  recoveryUrlWithoutCredentials,
} from '../client/src/lib/recovery-token';

describe('Phase 5E recovery URL handling', () => {
  it('extracts the access token from the Supabase hash fragment', () => {
    expect(
      extractRecoveryToken(
        'https://example.test/reset-password#access_token=hash-token&refresh_token=refresh-token&type=recovery',
      ),
    ).toBe('hash-token');
  });

  it('removes credential keys from both components while preserving unrelated fields', () => {
    expect(
      recoveryUrlWithoutCredentials(
        'https://example.test/reset-password?source=email&code=secret#access_token=hash-token&refresh_token=refresh-token&type=recovery&next=welcome',
      ),
    ).toBe('/reset-password?source=email#next=welcome');
  });

  it('rejects ordinary hash access tokens without a recovery type', () => {
    expect(
      extractRecoveryToken('https://example.test/reset-password#access_token=ordinary-token&type=invite'),
    ).toBeNull();
  });

  it('rejects query access tokens while scrubbing all credential keys', () => {
    expect(extractRecoveryToken('https://example.test/reset-password?access_token=query-token')).toBeNull();
    expect(
      recoveryUrlWithoutCredentials(
        'https://example.test/reset-password?access_token=query-token&refresh_token=refresh&keep=yes#token=t&token_hash=th&code=c&type=recovery&safe=1',
      ),
    ).toBe('/reset-password?keep=yes#safe=1');
  });
});