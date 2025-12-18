import { type Express } from 'express';
import { supabaseAdmin, isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';

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
        const { error } = await supabaseAdmin
          .from('users')
          .select('id')
          .limit(1);

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

    // Warn if heap usage is over 80%
    if (memUsageMB.heapUsed / memUsageMB.heapTotal > 0.8) {
      health.checks.memory = 'warning';
      logger.warn('Health check: High memory usage', { memUsageMB });
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
    });
  });

  // Readiness probe (for Kubernetes-style orchestration)
  app.get('/ready', async (req, res) => {
    try {
      // Skip DB check if Supabase not configured (development)
      if (!isSupabaseConfigured) {
        return res.status(200).json({ ready: true, note: 'Running without database (dev mode)' });
      }

      // Simple check if the app is ready to serve traffic
      const { error } = await supabaseAdmin
        .from('users')
        .select('id')
        .limit(1);

      if (error) {
        throw error;
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
