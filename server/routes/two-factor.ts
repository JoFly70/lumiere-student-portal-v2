/**
 * Two-Factor Authentication API Routes
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { logger } from '../lib/logger';
import { supabaseAdmin } from '../lib/supabase';
import {
  generate2FASecret,
  verify2FAToken,
  generateBackupCodes,
  formatBackupCode,
  sanitizeBackupCode,
} from '../lib/two-factor';

const router = Router();

// All 2FA routes require authentication
router.use(requireAuth);

/**
 * POST /api/2fa/setup
 * Initialize 2FA setup for the current user
 * Returns QR code and secret for authenticator app
 */
router.post('/setup', async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Only allow admin, coach, and staff to enable 2FA
    if (!['admin', 'coach', 'staff'].includes(user.role)) {
      return res.status(403).json({
        error: '2FA is only available for admin and staff accounts',
      });
    }

    // Check if 2FA is already enabled
    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('two_factor_enabled')
      .eq('id', user.id)
      .single();

    if (userData?.two_factor_enabled) {
      return res.status(400).json({
        error: '2FA is already enabled. Disable it first to set up again.',
      });
    }

    // Generate new 2FA secret
    const { secret, qrCode, otpauth } = await generate2FASecret(user.email);

    // Store secret temporarily (user must verify before it's permanently enabled)
    await supabaseAdmin
      .from('users')
      .update({
        two_factor_secret_temp: secret,
      })
      .eq('id', user.id);

    logger.info('2FA setup initiated', {
      userId: user.id,
      email: user.email,
    });

    return res.json({
      qrCode,
      secret, // Also return as text for manual entry
      otpauth,
    });
  } catch (error) {
    logger.error('2FA setup error', {
      error: error instanceof Error ? error.message : String(error),
      userId: (req as any).user?.id,
    });
    return res.status(500).json({ error: 'Failed to set up 2FA' });
  }
});

/**
 * POST /api/2fa/verify-setup
 * Verify 2FA setup by validating a token
 * Enables 2FA and generates backup codes
 */
router.post('/verify-setup', async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const schema = z.object({
      token: z.string().length(6),
    });

    const { token } = schema.parse(req.body);

    // Get temporary secret
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('two_factor_secret_temp')
      .eq('id', user.id)
      .single();

    if (userError || !userData?.two_factor_secret_temp) {
      return res.status(400).json({
        error: '2FA setup not found. Please start setup first.',
      });
    }

    // Verify the token
    const isValid = verify2FAToken(token, userData.two_factor_secret_temp);

    if (!isValid) {
      return res.status(400).json({
        error: 'Invalid verification code. Please try again.',
      });
    }

    // Generate backup codes
    const backupCodes = generateBackupCodes(10);

    // Hash backup codes for storage (never store plaintext)
    const crypto = await import('crypto');
    const hashedBackupCodes = backupCodes.map((code) =>
      crypto.createHash('sha256').update(code).digest('hex')
    );

    // Enable 2FA permanently
    await supabaseAdmin
      .from('users')
      .update({
        two_factor_enabled: true,
        two_factor_secret: userData.two_factor_secret_temp,
        two_factor_secret_temp: null,
        two_factor_backup_codes: hashedBackupCodes,
      })
      .eq('id', user.id);

    logger.info('2FA enabled successfully', {
      userId: user.id,
      email: user.email,
    });

    // Return backup codes (this is the ONLY time they're shown)
    return res.json({
      success: true,
      message: '2FA enabled successfully',
      backupCodes: backupCodes.map(formatBackupCode),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
    }

    logger.error('2FA verification error', {
      error: error instanceof Error ? error.message : String(error),
      userId: (req as any).user?.id,
    });
    return res.status(500).json({ error: 'Failed to verify 2FA' });
  }
});

/**
 * POST /api/2fa/disable
 * Disable 2FA for the current user
 */
router.post('/disable', async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const schema = z.object({
      password: z.string(),
    });

    const { password } = schema.parse(req.body);

    // Verify password before disabling 2FA
    const { error: authError } = await supabaseAdmin.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (authError) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Disable 2FA
    await supabaseAdmin
      .from('users')
      .update({
        two_factor_enabled: false,
        two_factor_secret: null,
        two_factor_secret_temp: null,
        two_factor_backup_codes: null,
      })
      .eq('id', user.id);

    logger.warn('2FA disabled', {
      userId: user.id,
      email: user.email,
    });

    return res.json({
      success: true,
      message: '2FA has been disabled',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
    }

    logger.error('2FA disable error', {
      error: error instanceof Error ? error.message : String(error),
      userId: (req as any).user?.id,
    });
    return res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

/**
 * POST /api/2fa/verify
 * Verify a 2FA token during login
 * This would be called from the login flow
 */
router.post('/verify', async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const schema = z.object({
      token: z.string().min(6).max(10), // 6 digits or 8-char backup code
    });

    const { token } = schema.parse(req.body);

    // Get user's 2FA settings
    const { data: userData, error: userError } = await supabaseAdmin
      .from('users')
      .select('two_factor_enabled, two_factor_secret, two_factor_backup_codes')
      .eq('id', user.id)
      .single();

    if (userError || !userData) {
      return res.status(500).json({ error: 'Failed to verify 2FA' });
    }

    if (!userData.two_factor_enabled) {
      return res.status(400).json({ error: '2FA is not enabled' });
    }

    // Check if it's a backup code or regular token
    if (token.length > 6) {
      // Backup code
      const sanitized = sanitizeBackupCode(token);
      const crypto = await import('crypto');
      const hashedCode = crypto.createHash('sha256').update(sanitized).digest('hex');

      const backupCodes = userData.two_factor_backup_codes || [];

      if (!backupCodes.includes(hashedCode)) {
        return res.status(400).json({ error: 'Invalid backup code' });
      }

      // Remove used backup code
      const remainingCodes = backupCodes.filter((code) => code !== hashedCode);
      await supabaseAdmin
        .from('users')
        .update({ two_factor_backup_codes: remainingCodes })
        .eq('id', user.id);

      logger.info('2FA backup code used', {
        userId: user.id,
        remainingCodes: remainingCodes.length,
      });

      return res.json({
        success: true,
        message: '2FA verified with backup code',
        remainingBackupCodes: remainingCodes.length,
      });
    }

    // Regular TOTP token
    const isValid = verify2FAToken(token, userData.two_factor_secret);

    if (!isValid) {
      logger.warn('2FA verification failed', {
        userId: user.id,
        email: user.email,
      });
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    logger.info('2FA verified successfully', {
      userId: user.id,
      email: user.email,
    });

    return res.json({
      success: true,
      message: '2FA verified successfully',
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        details: error.errors,
      });
    }

    logger.error('2FA verification error', {
      error: error instanceof Error ? error.message : String(error),
      userId: (req as any).user?.id,
    });
    return res.status(500).json({ error: 'Failed to verify 2FA' });
  }
});

/**
 * GET /api/2fa/status
 * Get 2FA status for current user
 */
router.get('/status', async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user || !user.id) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { data: userData } = await supabaseAdmin
      .from('users')
      .select('two_factor_enabled, two_factor_backup_codes')
      .eq('id', user.id)
      .single();

    const backupCodesRemaining = userData?.two_factor_backup_codes?.length || 0;

    return res.json({
      enabled: userData?.two_factor_enabled || false,
      backupCodesRemaining,
      eligible: ['admin', 'coach', 'staff'].includes(user.role),
    });
  } catch (error) {
    logger.error('2FA status error', {
      error: error instanceof Error ? error.message : String(error),
      userId: (req as any).user?.id,
    });
    return res.status(500).json({ error: 'Failed to get 2FA status' });
  }
});

export default router;
