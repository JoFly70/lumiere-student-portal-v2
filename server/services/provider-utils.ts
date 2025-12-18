/**
 * Provider Utility Functions
 * Centralized provider lookup and validation
 */

import { db } from '../lib/db';
import { providers } from '@shared/schema';
import { logger } from '../lib/logger';

// Provider key → UUID mapping cache
let providerCache: Map<string, string> | null = null;

/**
 * Normalize provider key: lowercase and convert hyphens to underscores
 * This ensures "study-com" and "study_com" both work
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/-/g, '_');
}

/**
 * Get provider UUID by human-readable key (sophia, study_com, ace, umpi, other)
 * 
 * This helper normalizes provider identifiers at the service boundary:
 * - Frontend sends human-readable keys like "sophia" or "study-com"
 * - Database expects UUIDs from the providers table
 * - This function caches the mapping and validates unknown keys
 * - Accepts both hyphenated ("study-com") and underscored ("study_com") formats
 * 
 * @param key - Human-readable provider key (case-insensitive, hyphen/underscore agnostic)
 * @returns Provider UUID from the database
 * @throws Error if provider key is not found
 */
export async function getProviderIdByKey(key: string): Promise<string> {
  // Initialize cache on first use
  if (!providerCache) {
    const allProviders = await db.select().from(providers);
    providerCache = new Map(
      allProviders.map(p => [normalizeKey(p.key), p.id])
    );
    logger.info('Provider cache initialized', { count: providerCache.size });
  }

  const normalizedKey = normalizeKey(key);
  const providerId = providerCache.get(normalizedKey);
  if (!providerId) {
    logger.error('Unknown provider key', { 
      key, 
      normalizedKey,
      availableKeys: Array.from(providerCache.keys()) 
    });
    throw new Error(`Unknown provider: ${key}`);
  }

  return providerId;
}

/**
 * Check if a string is already a UUID
 */
export function isUUID(str: string): boolean {
  return str.includes('-') && str.length === 36;
}

/**
 * Normalize provider ID: convert key to UUID if needed, pass through if already UUID
 */
export async function normalizeProviderId(providerId: string): Promise<string> {
  return isUUID(providerId) 
    ? providerId 
    : await getProviderIdByKey(providerId);
}
