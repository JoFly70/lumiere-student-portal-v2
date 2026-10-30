import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@shared/schema';

const connectionString = process.env.DATABASE_URL;

let client: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

function getDb() {
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set. Please configure database credentials in deployment settings.');
  }

  if (!dbInstance) {
    // The isolated staging session pooler has a small shared connection budget.
    // Promise.all projections plus a concurrent QA runner must not each reserve
    // the driver's default ten sessions. Production behavior is unchanged.
    const guardedStaging = process.env.NODE_ENV === "development"
      && process.env.S22_STAGING_PROJECT_REF === "tqgwoyzlnkqwkcjsiocd";
    // DB_POOL_MAX (1–20) caps this process's connections: the production session pooler allows 15 clients
    // in total, shared with the running app, so one-off scripts (demo provisioning) must stay small.
    const poolMax = Number(process.env.DB_POOL_MAX);
    const capped = Number.isInteger(poolMax) && poolMax >= 1 && poolMax <= 20 ? { max: poolMax, idle_timeout: 10 } : null;
    client = postgres(connectionString, guardedStaging ? { max: 2, idle_timeout: 10 } : capped ?? {});
    dbInstance = drizzle(client, { schema });
  }

  return dbInstance;
}

// Export a proxy that creates the connection on first access
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(target, prop) {
    const instance = getDb();
    const value = (instance as any)[prop];
    return typeof value === 'function' ? value.bind(instance) : value;
  }
});

/** Explicit shutdown for bounded staging/test runners; never called by the server. */
export async function closeDatabase(): Promise<void> {
  if (client) await client.end({ timeout: 5 });
  client = null;
  dbInstance = null;
}
