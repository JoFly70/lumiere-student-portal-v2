# Production Configuration Notes

## Security Improvements Implemented

### 1. Content Security Policy (CSP)
**Status**: ✅ Fixed

**Issue**: Initial implementation allowed `'unsafe-inline'` and `'unsafe-eval'` in production, creating XSS vulnerabilities.

**Solution**: 
- Split CSP into production (strict) and development (permissive) configurations
- Production CSP:
  - ❌ No `'unsafe-inline'` scripts
  - ❌ No `'unsafe-eval'` 
  - ✅ Only trusted domains (Stripe, Supabase, self)
- Development CSP:
  - ✅ Allows inline scripts for Vite HMR
  - ✅ Allows eval for Vite dev mode

### 2. Rate Limiting
**Status**: ✅ Configured (with Redis note for scaling)

**Implementation**:
- API routes: 100 req/15min per IP
- Admin routes: 30 req/15min per IP  
- Auth endpoints: 5 req/15min per IP
- **Webhook routes**: Excluded from rate limiting (Stripe handles their own)

**Note for Production Scale**:
When running multiple server instances (Autoscale deployment), add Redis store:
```typescript
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';

const redisClient = createClient({ url: process.env.REDIS_URL });
const store = new RedisStore({ client: redisClient });

const apiLimiter = rateLimit({
  ...rateLimitConfig.api,
  store, // Add Redis store
});
```

### 3. Stripe Webhook Security
**Status**: ✅ Signature verification + graceful degradation

**Features**:
- Webhook signature verification using `STRIPE_WEBHOOK_SECRET`
- Raw body preservation for signature validation
- Graceful handling when Stripe not configured (dev mode)
- Guarded database mutations (no-op when Supabase not configured)

**API Version**: `2025-10-29.clover` (latest as of Nov 2025)

### 4. Supabase Database Guards
**Status**: ✅ All webhook handlers guarded

**Protection**: All database mutations check `isSupabaseConfigured` before attempting operations
- Prevents runtime errors in development without Supabase
- Logs warnings when events occur but database unavailable

## Configuration Files

### `server/config/production.ts`
Contains all production configuration:
- Helmet security headers
- CORS settings
- Rate limit configurations
- Session cookie settings
- Compression settings

### `server/lib/logger.ts`
Winston logger with:
- JSON format in production
- Pretty format in development
- Request ID tracking
- Error context logging

### `server/routes/health.ts`
Health check endpoints:
- `/health` - Full health check (DB + memory)
- `/ready` - Readiness probe (K8s-style)
- `/live` - Liveness probe (K8s-style)

### `server/routes/webhooks.ts`
Stripe webhook handlers:
- Payment intents (succeeded/failed)
- Subscriptions (created/updated/deleted)
- Invoices (paid/failed)

## Production Checklist

Before deploying to production:

### Required Secrets
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_ANON_KEY`
- [ ] `SUPABASE_SERVICE_KEY`
- [ ] `DATABASE_URL`
- [ ] `SESSION_SECRET` (generate 256-bit random key)
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `CUSTOM_DOMAIN` (portal.lumiere.college)
- [ ] `NODE_ENV=production`

### Optional Secrets (Recommended)
- [ ] `SENTRY_DSN` (error tracking)
- [ ] `REDIS_URL` (for distributed rate limiting)

### Deployment Steps
1. Set `NODE_ENV=production` in Replit Secrets
2. Publish as Reserved VM (2-4 vCPU recommended)
3. Configure custom domain DNS
4. Set up Stripe webhook endpoint
5. Verify health check: `https://portal.lumiere.college/health`
6. Monitor logs for first 24 hours

### Security Verification
- [ ] HTTPS working (automatic via Replit)
- [ ] Security headers present (check with securityheaders.com)
- [ ] CSP violations not occurring (check browser console)
- [ ] Rate limiting working (test with excessive requests)
- [ ] Webhook signature verification working
- [ ] Admin routes protected (when auth is implemented)

### Performance Verification
- [ ] Gzip/Brotli compression enabled (check headers)
- [ ] Response times < 200ms (check /health endpoint)
- [ ] Memory usage stable (monitor /health memory field)
- [ ] No memory leaks after 24 hours

## Known Limitations

### 1. Log Retention
- **Replit limitation**: No automatic log export
- **Workaround**: Stream logs to external service (Datadog, Papertrail, Logtail)
- **Alternative**: Copy logs manually from Deployments → Logs tab

### 2. Background Workers
- **Replit limitation**: No separate worker processes
- **Current approach**: Run async jobs in same process
- **Alternative**: Use Supabase Edge Functions for heavy processing

### 3. GitHub CI/CD
- **Replit limitation**: No native GitHub Actions integration
- **Workaround**: Manual redeploy via Replit dashboard
- **Alternative**: Use Replit's Git integration for version control

### 4. Redis for Rate Limiting
- **Current**: In-memory rate limiting (resets on redeploy)
- **Production recommendation**: Add Redis for distributed rate limiting
- **Impact**: Rate limits reset when redeploying or scaling instances

## Future Enhancements

### High Priority
1. **Two-Factor Authentication (2FA)** for admin users
2. **Redis integration** for distributed rate limiting
3. **Sentry integration** for error tracking
4. **Log streaming** to external service

### Medium Priority
1. **IP whitelisting** for admin routes
2. **DDoS protection** via Cloudflare
3. **CDN** for static assets (if high traffic)
4. **Database query optimization**

### Low Priority
1. **Image optimization/CDN**
2. **Automated security scans**
3. **Load testing** (k6, Artillery)
4. **Custom timeout configurations**

## Monitoring

### Key Metrics to Watch
- Request latency (target: <200ms p95)
- Error rate (target: <0.1%)
- Memory usage (target: <80% heap)
- Database connection pool (check Supabase dashboard)
- Webhook processing time (target: <500ms)

### Alerting Recommendations
- **Uptime monitoring**: UptimeRobot, Pingdom
- **Error tracking**: Sentry
- **Performance**: New Relic, DataDog
- **Custom alerts**: Based on /health endpoint

## Cost Optimization

### Reserved VM Recommendations
- **Small apps (<1000 users)**: 2 vCPU / 8GB RAM (~$25-35/month)
- **Medium apps (1000-10000 users)**: 4 vCPU / 16GB RAM (~$50-70/month)
- **Large apps (10000+ users)**: Consider Autoscale deployment

### Autoscale Considerations
- Pay per use (good for variable traffic)
- Scales to zero when idle (optional)
- Typically $20-100/month depending on traffic
- Better for unpredictable traffic patterns

## Support Resources

- **Replit Docs**: https://docs.replit.com
- **Supabase Docs**: https://supabase.com/docs
- **Stripe Docs**: https://stripe.com/docs
- **Helmet CSP Guide**: https://helmetjs.github.io
- **Express Rate Limit**: https://github.com/express-rate-limit/express-rate-limit
