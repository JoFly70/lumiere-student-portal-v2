# Deployment Guide - Lumiere Student Portal

This guide explains how to deploy the Lumiere Student Portal to production with all features enabled.

## Prerequisites

Before deploying, you need:
1. A Supabase project with your database set up
2. Stripe account for payment processing (optional)
3. Redis instance for distributed rate limiting (optional)
4. Sentry account for error tracking (optional)

## Deployment Secrets Configuration

The application uses Replit's deployment secrets system. Navigate to your deployment settings to configure these secrets.

### Required Secrets

None! The application will start successfully without any additional secrets. However, to enable database features, you'll need to add Supabase credentials.

### Recommended Secrets (Database)

To enable all database features, add these secrets:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
```

**Where to find these:**
1. Go to your Supabase project dashboard
2. Navigate to Project Settings → API
3. Copy the Project URL for `SUPABASE_URL`
4. Copy the `service_role` key for `SUPABASE_SERVICE_KEY`

### Optional Secrets

**Stripe Integration:**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

**Redis Rate Limiting:**
```
REDIS_URL=redis://username:password@hostname:port
```

**Sentry Error Tracking:**
```
SENTRY_DSN=https://...@sentry.io/...
```
(Note: Requires installing Sentry packages: `@sentry/node` and `@sentry/profiling-node`)

**Custom Domain:**
```
CUSTOM_DOMAIN=portal.lumiere.college
```

## Environment Detection

The application automatically detects the environment:
- `NODE_ENV=production` is set automatically by Replit deployments
- Production mode enables:
  - Strict Content Security Policy (no unsafe-inline/eval)
  - HSTS headers
  - Secure session cookies
  - Redis-backed rate limiting (when REDIS_URL is set)

## Deployment Steps

1. **Configure Deployment Secrets** (optional but recommended)
   - Add Supabase credentials to enable database features
   - Add other optional secrets as needed

2. **Enable Always-On** (recommended)
   - Keeps your application running 24/7
   - Required for webhook endpoints

3. **Configure Custom Domain** (optional)
   - Add your domain in deployment settings
   - Set `CUSTOM_DOMAIN` secret to match

4. **Deploy**
   - Click "Deploy" in the Replit interface
   - The application will start successfully even without Supabase
   - Check `/health` endpoint to verify status

## Health Checks

The application provides multiple health check endpoints:

- `GET /health` - Overall health status
  - Returns `200 OK` if system is healthy
  - Returns `503 Service Unavailable` if degraded
  - Database status will be `not_configured` if Supabase secrets are missing (this is OK)

- `GET /ready` - Readiness probe
  - Returns `200 OK` when ready to serve traffic
  - Works without database in development mode

- `GET /live` - Liveness probe
  - Returns `200 OK` if application is running

## Graceful Degradation

The application is designed to start successfully even without optional services:

| Service | When Missing | Behavior |
|---------|-------------|----------|
| Supabase | Logs warning | App starts, database features disabled, health returns "ok" |
| Redis | Silent fallback | Uses in-memory rate limiting instead |
| Stripe | Logs warning | App starts, webhook endpoints return 503 |
| Sentry | Silent skip | No error tracking, app works normally |

## Monitoring

**Production Logs:**
- Structured JSON logging with Winston
- Log levels: error, warn, info, debug
- All requests are logged with unique request IDs

**Health Check Monitoring:**
```bash
# Check overall health
curl https://your-app.replit.app/health

# Expected response when database not configured:
{
  "status": "ok",
  "checks": {
    "database": "not_configured",
    "memory": "ok"
  }
}
```

## Security Features

All enabled automatically in production:

✅ Helmet security headers  
✅ Strict Content Security Policy  
✅ HSTS with preload  
✅ CORS protection  
✅ Rate limiting (Redis-backed or in-memory)  
✅ Secure session cookies (httpOnly, secure, sameSite)  
✅ Stripe webhook signature verification  
✅ Request logging with sanitization  

## Troubleshooting

**Application won't start:**
- Check deployment logs for errors
- Verify all required secrets are set correctly
- Test `/health` endpoint after deployment

**Database features not working:**
- Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are set in deployment secrets
- Check health endpoint: `database` status should be "ok"
- Review application logs for connection errors

**Webhooks failing:**
- Verify `STRIPE_SECRET_KEY` is set
- Check webhook signature verification in logs
- Ensure Always-On is enabled for reliable webhook delivery

## Next Steps After Deployment

1. ✅ Verify health endpoints return expected status
2. ✅ Add Supabase credentials to enable database features
3. ✅ Configure Stripe for payment processing
4. ✅ Set up Redis for distributed rate limiting (optional)
5. ✅ Install and configure Sentry for error tracking (optional)
6. ✅ Configure custom domain and SSL

## Support

For deployment issues:
- Check Replit deployment documentation
- Review application logs in deployment dashboard
- Test health endpoints to diagnose issues
