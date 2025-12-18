/**
 * Two-Factor Authentication (2FA) Service
 * TOTP-based 2FA for admin and staff accounts
 */

import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
import { logger } from './logger';

// Application details for 2FA
const APP_NAME = 'Lumiere Portal';
const ISSUER = 'Lumiere Education';

/**
 * Generate a new 2FA secret for a user
 * Returns secret key and QR code data URL
 */
export async function generate2FASecret(userEmail: string): Promise<{
  secret: string;
  qrCode: string;
  otpauth: string;
}> {
  try {
    // Generate a random secret (base32 encoded)
    const secret = new Secret({ size: 20 });

    // Create TOTP instance
    const totp = new TOTP({
      issuer: ISSUER,
      label: userEmail,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    // Get otpauth URL for QR code
    const otpauth = totp.toString();

    // Generate QR code as data URL
    const qrCode = await QRCode.toDataURL(otpauth);

    return {
      secret: secret.base32,
      qrCode,
      otpauth,
    };
  } catch (error) {
    logger.error('Failed to generate 2FA secret', {
      error: error instanceof Error ? error.message : String(error),
      userEmail,
    });
    throw new Error('Failed to generate 2FA secret');
  }
}

/**
 * Verify a TOTP token against a secret
 * @param token - 6-digit code from authenticator app
 * @param secret - Base32-encoded secret
 * @param window - Number of time steps to check (for clock drift tolerance)
 * @returns true if token is valid
 */
export function verify2FAToken(
  token: string,
  secret: string,
  window: number = 1
): boolean {
  try {
    // Validate input
    if (!token || !secret) {
      return false;
    }

    // Remove spaces and validate format
    const sanitizedToken = token.replace(/\s/g, '');
    if (!/^\d{6}$/.test(sanitizedToken)) {
      logger.warn('Invalid 2FA token format', { tokenLength: sanitizedToken.length });
      return false;
    }

    // Create TOTP instance with the secret
    const totp = new TOTP({
      issuer: ISSUER,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });

    // Validate token with time window for clock drift
    // Window of 1 means we accept tokens from previous and next time step
    const delta = totp.validate({
      token: sanitizedToken,
      window,
    });

    // delta is null if invalid, or the time step difference if valid
    const isValid = delta !== null;

    if (!isValid) {
      logger.warn('2FA token validation failed', {
        tokenPrefix: sanitizedToken.substring(0, 2),
      });
    }

    return isValid;
  } catch (error) {
    logger.error('2FA token verification error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Generate backup codes for 2FA recovery
 * Returns an array of one-time use backup codes
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];

  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric code
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    codes.push(code);
  }

  return codes;
}

/**
 * Format backup codes for display
 * Groups codes with dashes for readability
 */
export function formatBackupCode(code: string): string {
  // Format as XXXX-XXXX
  return code.match(/.{1,4}/g)?.join('-') || code;
}

/**
 * Validate backup code format
 */
export function isValidBackupCode(code: string): boolean {
  // Remove dashes and validate
  const sanitized = code.replace(/-/g, '').toUpperCase();
  return /^[A-Z0-9]{8}$/.test(sanitized);
}

/**
 * Sanitize backup code for comparison
 */
export function sanitizeBackupCode(code: string): string {
  return code.replace(/-/g, '').toUpperCase();
}
