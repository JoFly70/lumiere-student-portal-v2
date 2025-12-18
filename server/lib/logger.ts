import winston from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

// Custom format for development (pretty print)
const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}] ${message} ${metaStr}`;
  })
);

// Production format (JSON for log aggregation)
const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: isProduction ? prodFormat : devFormat,
  defaultMeta: {
    service: 'lumiere-portal',
    env: process.env.NODE_ENV,
  },
  transports: [
    new winston.transports.Console(),
  ],
});

// Request ID middleware helper
export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
}

// Log HTTP requests
export function logRequest(method: string, path: string, statusCode: number, duration: number, meta?: any) {
  const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  logger.log(level, `${method} ${path} ${statusCode}`, {
    method,
    path,
    statusCode,
    duration,
    ...meta,
  });
}

// Log errors with full context
export function logError(error: Error, context?: Record<string, any>) {
  logger.error(error.message, {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    ...context,
  });
}

// Log Supabase connection status
export function logSupabaseConnection(success: boolean, error?: Error) {
  if (success) {
    logger.info('✓ Supabase connected successfully');
  } else {
    logger.error('✗ Supabase connection failed', {
      error: error?.message,
      stack: error?.stack,
    });
  }
}

// Log startup information
export function logStartup(port: number) {
  logger.info(`🚀 Lumiere Portal starting on port ${port}`, {
    port,
    env: process.env.NODE_ENV,
    nodeVersion: process.version,
  });
}
