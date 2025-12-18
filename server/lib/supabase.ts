import { createClient } from '@supabase/supabase-js';
import { logger } from './logger';

// Support both NEXT_PUBLIC_* and standard naming conventions
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Warn if Supabase credentials are not configured (but allow startup)
// This enables graceful degradation in both development and production
if (!supabaseUrl || !supabaseServiceKey) {
  logger.warn('⚠️  Supabase credentials not configured. Database features will not work.');
  logger.warn('   Set SUPABASE_URL and SUPABASE_SERVICE_KEY in deployment secrets to enable database.');
}

// Create a dummy client if credentials are missing (dev mode only)
const dummyUrl = 'http://localhost:54321';
const dummyKey = 'dummy-key-for-development';

// Server-side client with service role key for admin operations
export const supabaseAdmin = createClient(
  supabaseUrl || dummyUrl,
  supabaseServiceKey || dummyKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Check if Supabase is properly configured
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseServiceKey);

// Client for frontend (will use anon key)
export function getSupabaseClient(anonKey: string) {
  if (!supabaseUrl) {
    throw new Error('SUPABASE_URL is not set');
  }
  return createClient(supabaseUrl, anonKey);
}
