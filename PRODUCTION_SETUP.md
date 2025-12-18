# Production Deployment Guide for Lumiere Student Portal

This guide covers deploying your Lumiere Student Portal to production on Replit with enterprise-grade security and performance.

## Prerequisites

Before deploying, ensure you have:
- ✅ Supabase project configured (see [SUPABASE_SETUP.md](./SUPABASE_SETUP.md))
- ✅ All environment variables set in Replit Secrets
- ✅ Custom domain ready (portal.lumiere.college)

## Step 1: Configure Environment Variables

Add these secrets in the Replit **Secrets** tab (lock icon):

### Required Secrets
```bash
# Supabase
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres

# Session
SESSION_SECRET=<generate-random-256-bit-key>

# Stripe (for billing)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# Custom Domain
CUSTOM_DOMAIN=portal.lumiere.college

# Node Environment
NODE_ENV=production
```

### Optional Secrets (Future)
```bash
# Error tracking (recommended for production)
SENTRY_DSN=https://...@sentry.io/...

# Email service (for notifications)
SENDGRID_API_KEY=SG....
```

## Step 2: Publish to Production

### Option A: Reserved VM (Recommended)
Best for always-on performance with predictable costs.

1. Click **Publish** button at top of Replit workspace
2. Select **Reserved VM**
3. Choose machine size:
   - **2 vCPU / 8GB RAM** - Recommended for production
   - **4 vCPU / 16GB RAM** - For high traffic
4. Click **Deploy**

### Option B: Autoscale Deployment
Best for variable traffic with automatic scaling.

1. Click **Publish** button
2. Select **Autoscale**
3. Configure scaling:
   - Min instances: 1
   - Max instances: 5
   - Scale-to-zero: Disabled (for always-on)
4. Click **Deploy**

## Step 3: Configure Custom Domain

1. Go to **Deployments** tab → **Settings**
2. Click **Link a domain**
3. Enter your domain: `portal.lumiere.college`
4. Copy the DNS records provided by Replit

### Update DNS Records (at your registrar)

Add these records to your domain registrar (e.g., Namecheap, GoDaddy):

```
Type: A
Host: portal
Value: [IP from Replit]
TTL: 300

Type: TXT
Host: portal
Value: [TXT value from Replit]
TTL: 300
```

5. Wait for DNS propagation (5 minutes - 48 hours)
6. Replit will automatically provision TLS/SSL certificate
7. Status will show "Verified" when ready

## Step 4: Configure Stripe Webhooks

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Enter webhook URL:
   ```
   https://portal.lumiere.college/api/webhooks/stripe
   ```
4. Select events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the **Signing secret** (starts with `whsec_`)
6. Add it to Replit Secrets as `STRIPE_WEBHOOK_SECRET`

## Step 5: Verify Production Features

After deployment, test these production features:

### ✅ Security
- [ ] HTTPS working (automatic via Replit)
- [ ] Security headers present (test with [securityheaders.com](https://securityheaders.com))
- [ ] CORS working (test cross-origin requests)
- [ ] Rate limiting active (test excessive requests)
- [ ] Admin routes protected

### ✅ Performance
- [ ] Gzip/Brotli compression enabled
- [ ] Static assets cached (check Cache-Control headers)
- [ ] Response times < 200ms (check /health endpoint)

### ✅ Monitoring
- [ ] Health check working: `https://portal.lumiere.college/health`
- [ ] Logs visible in Deployments → Logs tab
- [ ] Error tracking configured (if using Sentry)

### ✅ Webhooks
- [ ] Stripe webhook endpoint accessible
- [ ] Webhook signature verification working
- [ ] Test payment events processed correctly

## Production Features Enabled

Your app now has these production features enabled:

### 🔒 Security Headers (Helmet)
- **HSTS**: Force HTTPS for 1 year
- **CSP**: Strict Content Security Policy
- **X-Frame-Options**: Prevent clickjacking
- **X-Content-Type-Options**: Prevent MIME sniffing
- **Referrer-Policy**: Strict origin control

### 🚦 Rate Limiting
- **API routes**: 100 req/15min per IP
- **Admin routes**: 30 req/15min per IP
- **Auth endpoints**: 5 req/15min per IP
- **Webhooks**: 1000 req/min (no blocking)

### ⚡ Performance
- **Gzip/Brotli**: Automatic compression for responses > 1KB
- **HTTP/2**: Enabled automatically by Replit
- **Static caching**: 1 year cache for assets
- **Request tracing**: X-Request-ID header on all responses

### 📊 Monitoring
- **Health checks**: `/health`, `/ready`, `/live` endpoints
- **Structured logging**: JSON logs with Winston
- **Request logging**: Full HTTP request/response tracking
- **Error tracking**: Detailed error context

### 🔌 Integrations
- **Stripe webhooks**: Signature-verified payment events
- **Supabase**: Row-Level Security enforced
- **CORS**: Configured for portal.lumiere.college
- **Secure cookies**: httpOnly, secure, sameSite

## Monitoring and Logs

### View Real-Time Logs
1. Go to **Deployments** tab
2. Click **Logs** tab
3. Filter by:
   - Errors only
   - Search text
   - Date range

### Health Check Endpoint
Check app status anytime:
```bash
curl https://portal.lumiere.college/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-07T16:00:00.000Z",
  "uptime": 12345,
  "checks": {
    "database": "ok",
    "memory": "ok"
  },
  "duration": "12ms",
  "memory": {
    "rss": 150,
    "heapTotal": 100,
    "heapUsed": 75
  }
}
```

## Security Best Practices

### ✅ Already Configured
- [x] HTTPS/TLS enforced
- [x] Security headers (HSTS, CSP, etc.)
- [x] Rate limiting on all routes
- [x] Secure session cookies
- [x] Input validation with Zod
- [x] Row-Level Security (RLS) in Supabase
- [x] Webhook signature verification

### 🔧 To Configure (Future Tasks)
- [ ] Two-factor authentication (2FA) for admin users
- [ ] IP whitelisting for admin routes
- [ ] Automated security scans
- [ ] DDoS protection (consider Cloudflare)

## Performance Optimization

### Already Optimized
- ✅ Gzip/Brotli compression
- ✅ Static asset caching
- ✅ Database connection pooling (Supabase)
- ✅ Request tracing

### Future Optimizations
- [ ] CDN for static assets (if high traffic)
- [ ] Redis caching for frequently accessed data
- [ ] Database query optimization
- [ ] Image optimization/CDN

## Limitations and Workarounds

### What Replit Does NOT Support

1. **GitHub CI/CD Auto-Deploy**
   - ❌ No native GitHub Actions integration
   - ✅ Alternative: Manual redeploy via Replit dashboard
   - ✅ Alternative: Use Replit's built-in Git integration

2. **Log Export/Retention**
   - ❌ No automatic log export to S3/external service
   - ✅ Alternative: Stream logs to external service (Datadog, Papertrail)
   - ✅ Alternative: Copy logs manually from Logs tab

3. **Background Workers**
   - ❌ No separate worker processes
   - ✅ Alternative: Run in same process with async jobs
   - ✅ Alternative: Use external service (Supabase Edge Functions)

4. **Custom Timeouts**
   - ❌ Cannot configure reverse proxy timeout at platform level
   - ✅ Note: Replit has reasonable defaults (120s+)
   - ✅ Configure timeouts in application code if needed

## Rollback Procedure

If you need to rollback to a previous version:

1. Go to **Deployments** tab
2. Click on the current deployment
3. View **Deployment History**
4. Click **Redeploy** on a previous version

## Cost Estimation

### Reserved VM (Recommended)
- **2 vCPU / 8GB RAM**: ~$25-35/month
- **4 vCPU / 16GB RAM**: ~$50-70/month
- **Includes**: Always-on, HTTPS, custom domain, logs

### Autoscale
- **Cost**: Pay per use (CPU + RAM + bandwidth)
- **Typical**: $20-100/month depending on traffic
- **Scales to zero** when idle (optional)

## Troubleshooting

### Issue: "Missing Supabase environment variables"
**Solution**: Ensure all Supabase secrets are set in Replit Secrets tab

### Issue: "Webhook signature verification failed"
**Solution**: 
1. Check `STRIPE_WEBHOOK_SECRET` is correctly set
2. Verify webhook endpoint in Stripe dashboard matches deployed URL
3. Check raw body is being passed to Stripe verification

### Issue: "Rate limit exceeded"
**Solution**: 
- Increase rate limits in `server/config/production.ts`
- Or implement IP whitelisting for known good actors

### Issue: "Health check failing"
**Solution**:
1. Check `/health` endpoint logs
2. Verify Supabase connection
3. Check memory usage (restart if high)

## Next Steps

After production deployment:

1. **Monitor for 24 hours** - Watch logs for errors
2. **Load test** - Use tools like k6 or Artillery
3. **Set up alerts** - Configure uptime monitoring (UptimeRobot, Pingdom)
4. **Enable Sentry** - Add error tracking for production issues
5. **Backup strategy** - Supabase has automatic backups, verify schedule
6. **SSL certificate** - Replit handles this, but verify it's working

## Support

- **Replit Docs**: https://docs.replit.com
- **Supabase Docs**: https://supabase.com/docs
- **Stripe Docs**: https://stripe.com/docs/webhooks

---

**Production Checklist**: ✅ Security | ✅ Performance | ✅ Monitoring | ✅ Webhooks | ✅ Health Checks
