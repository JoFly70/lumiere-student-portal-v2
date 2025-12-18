/**
 * Rate Limiting Middleware
 * Protects endpoints from brute force and DDoS attacks
 */

import rateLimit from 'express-rate-limit';
import { logger } from '../lib/logger';

/**
 * Aggressive rate limiting for authentication endpoints
 * - 5 attempts per 15 minutes per IP
 * - Prevents brute force password attacks
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: { error: 'Too many authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Auth rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(429).json({
      error: 'Too many authentication attempts. Please try again in 15 minutes.',
    });
  },
  skip: (req) => {
    // Skip rate limiting in test environment
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Rate limiting for password reset requests
 * - 3 attempts per hour per IP
 * - Prevents email enumeration attacks
 */
export const passwordResetRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per window
  message: { error: 'Too many password reset requests. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Password reset rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
    });
    res.status(429).json({
      error: 'Too many password reset requests. Please try again in an hour.',
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Moderate rate limiting for general API endpoints
 * - 100 requests per 15 minutes per IP
 * - Protects against general abuse
 */
export const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('API rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      method: req.method,
    });
    res.status(429).json({
      error: 'Too many requests. Please slow down.',
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Strict rate limiting for document uploads
 * - 10 uploads per hour per IP
 * - Prevents storage abuse
 */
export const uploadRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per window
  message: { error: 'Too many file uploads. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Upload rate limit exceeded', {
      ip: req.ip,
      userId: (req as any).user?.id,
    });
    res.status(429).json({
      error: 'Too many file uploads. Please try again in an hour.',
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
});

/**
 * Very strict rate limiting for signup
 * - 3 signups per hour per IP
 * - Prevents automated account creation
 */
export const signupRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 signups per window
  message: { error: 'Too many signup attempts. Please try again in an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Signup rate limit exceeded', {
      ip: req.ip,
      email: req.body?.email,
    });
    res.status(429).json({
      error: 'Too many signup attempts. Please try again in an hour.',
    });
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
});
