import { type Express } from 'express';
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';
import { validateProductionAuthReadiness } from '../lib/auth-readiness';
import { getRateLimitBackend } from '../lib/rate-limit-store';
import { getMemoryPressure } from '../lib/memory-pressure';

/** Upper bound for any single dependency probe so a hung database cannot hang the probe endpoint. */
export const HEALTH_PROBE_TIMEOUT_MS = 3000;

function withProbeTimeout<T>(probe: PromiseLike<T>, ms: number = HEALTH_PROBE_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
    Promise.resolve(probe).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function registerHealthRoutes(app: Express) {
  // Health check endpoint for monitoring/load balancers
  app.get('/health', async (req, res) => {
    const startTime = Date.now();
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV,
      checks: {
        database: 'unknown',
        memory: 'ok',
      },
    };

    try {
      // Check Supabase connection (only if configured)
      if (isSupabaseConfigured) {
        const { error } = await withProbeTimeout(supabaseAdmin
          .from('users')
          .select('id')
          .limit(1));

        health.checks.database = error ? 'error' : 'ok';

        if (error) {
          logger.warn('Health check: Database check failed', { error: error.message });
        }
      } else {
        health.checks.database = 'not_configured';
        logger.debug('Health check: Supabase not configured (development mode)');
      }
    } catch (error) {
      health.checks.database = 'error';
      logger.error('Health check: Database connection error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memUsageMB = {
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
    };

    // Allocated heap is elastic. Compare raw usage with actual V8/OS limits.
    const memoryPressure = getMemoryPressure(memUsage);
    health.checks.memory = memoryPressure.status;
    if (memoryPressure.status === 'warning') {
      logger.warn('Health check: High memory usage', { memUsageMB, memoryPressure });
    }

    // Overall status
    // System is OK if:
    // - Database is OK or not_configured (it's optional)
    // - Memory is OK
    const dbHealthy = health.checks.database === 'ok' || health.checks.database === 'not_configured';
    const memHealthy = health.checks.memory === 'ok';
    health.status = dbHealthy && memHealthy ? 'ok' : 'degraded';

    const statusCode = health.status === 'ok' ? 200 : 503;
    const duration = Date.now() - startTime;

    logger.debug('Health check completed', {
      status: health.status,
      duration,
      checks: health.checks,
    });

    res.status(statusCode).json({
      ...health,
      duration: `${duration}ms`,
      memory: memUsageMB,
      memoryPressure,
    });
  });

  // Readiness probe (for Kubernetes-style orchestration)
  app.get('/ready', async (req, res) => {
    let productionReadiness: Awaited<ReturnType<typeof validateProductionAuthReadiness>> | null = null;
    try {
      if (process.env.NODE_ENV === 'production') {
        productionReadiness = await validateProductionAuthReadiness({
          appUrl: process.env.APP_URL,
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
          databaseUrl: process.env.DATABASE_URL,
          supabaseAnonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
          sessionSecret: process.env.SESSION_SECRET,
          demoMode: process.env.ALLOW_DEMO_MODE === 'true',
          authEmailMode: process.env.AUTH_EMAIL_MODE,
          rateLimitBackend: getRateLimitBackend(),
        }, {
          checkTables: async () => {
            const [users, profiles] = await withProbeTimeout(Promise.all([
              supabaseAdmin.from('users').select('id').limit(1),
              supabaseAdmin.from('profiles').select('id').limit(1),
            ]));
            return { users: !users.error, profiles: !profiles.error };
          },
          checkAuthEmail: async () => {
            const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
            const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
            if (!supabaseUrl || !anonKey) return false;
            try {
              const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/settings`, {
                headers: { apikey: anonKey },
                signal: AbortSignal.timeout(3000),
              });
              if (!response.ok) return false;
              const settings = await response.json() as {
                disable_signup?: boolean;
                external?: { email?: boolean | { enabled?: boolean } };
              };
              const email = settings.external?.email;
              const emailEnabled = typeof email === 'boolean' ? email : email?.enabled === true;
              // Accounts are created only through the server's invitation flow,
              // so Supabase's own public signup must be disabled.
              return emailEnabled === true && settings.disable_signup === true;
            } catch {
              return false;
            }
          },
        });
        if (!productionReadiness.ready) {
          logger.warn('Production auth readiness check failed', { failures: productionReadiness.failures });
          return res.status(503).json({
            ready: false,
            checks: productionReadiness.checks,
            mailMode: productionReadiness.mailMode,
          });
        }
      }
      // Skip DB check if Supabase not configured (development)
      if (!isSupabaseConfigured) {
        return res.status(200).json({ ready: true, note: 'Running without database (dev mode)' });
      }

      // Simple check if the app is ready to serve traffic
      const { error } = await withProbeTimeout(supabaseAdmin
        .from('users')
        .select('id')
        .limit(1));

      if (error) {
        throw error;
      }

      if (productionReadiness) {
        return res.status(200).json({
          ready: true,
          checks: productionReadiness.checks,
          mailMode: productionReadiness.mailMode,
        });
      }
      res.status(200).json({ ready: true });
    } catch (error) {
      logger.error('Readiness check failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(503).json({ ready: false });
    }
  });

  // Liveness probe (for Kubernetes-style orchestration)
  app.get('/live', (req, res) => {
    // Simple check if the process is alive
    res.status(200).json({ alive: true });
  });
}
