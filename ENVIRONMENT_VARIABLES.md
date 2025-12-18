# Environment Variables Configuration

This document lists ALL environment variables needed for deploying the Lumiere Student Portal to production.

---

## 📍 Where to Get Supabase Credentials

### Step 1: Get Supabase Project URL and API Keys

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project: `ypbzdbfqoflyszdsbivn`
3. Navigate to **Settings → API**
4. Copy the following:
   - **Project URL** → Use for `SUPABASE_URL` and `VITE_SUPABASE_URL`
   - **anon public** key → Use for `VITE_SUPABASE_ANON_KEY`
   - **service_role** key (secret!) → Use for `SUPABASE_SERVICE_KEY`

### Step 2: Get Database Connection String

1. In Supabase Dashboard, go to **Settings → Database**
2. Scroll to **Connection string**
3. Select **Session pooler** (recommended for production)
4. Copy the connection string
5. Replace `[YOUR-PASSWORD]` with your actual database password
6. Use this for `DATABASE_URL`

Example format:
```
postgresql://postgres.ypbzdbfqoflyszdsbivn:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
```

---

## 🔐 Generate Random Secrets

### SESSION_SECRET
Generate a secure 32-character random string:

**Option 1: Using Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option 2: Using OpenSSL**
```bash
openssl rand -hex 32
```

**Option 3: Online Generator**
Visit: https://www.random.org/strings/ and generate a 64-character alphanumeric string

---

## 🌐 Frontend Environment Variables (Netlify)

Set these in **Netlify → Site Settings → Environment Variables**:

```bash
# Supabase (Frontend)
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key_here>

# Backend API URL
VITE_API_URL=<your_render_backend_url>
```

### Notes:
- `VITE_API_URL` should be your Render backend URL (e.g., `https://lumiere-portal-api.onrender.com`)
- Do NOT include a trailing slash in URLs
- These variables are prefixed with `VITE_` because we use Vite for the frontend build

---

## 🖥️ Backend Environment Variables (Render)

Set these in **Render → Service → Environment**:

```bash
# Node Environment
NODE_ENV=production

# Supabase Configuration (Client-side - for frontend builds)
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key_here>

# Supabase Configuration (Server-side)
SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
SUPABASE_SERVICE_KEY=<your_supabase_service_role_key_here>

# Database Connection
DATABASE_URL=postgresql://postgres.ypbzdbfqoflyszdsbivn:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Session Secret (generate a random 32-char string)
SESSION_SECRET=<generate_random_64_char_hex_string>

# CORS Configuration
CORS_ORIGIN=<your_netlify_frontend_url>

# Server Port (Render provides this automatically, but set default)
PORT=5000
```

### Important Notes:
- Replace `[YOUR-PASSWORD]` in DATABASE_URL with your actual password
- `CORS_ORIGIN` should be your Netlify URL (e.g., `https://lumiere-portal.netlify.app`)
- Do NOT include trailing slashes in URLs
- Keep `SUPABASE_SERVICE_KEY` secret - NEVER commit it to Git or expose it publicly

---

## 📧 Optional: SendGrid Email Configuration

If you want to enable email notifications (for password resets, ticket notifications, etc.):

### Get SendGrid API Key:
1. Go to [SendGrid Dashboard](https://app.sendgrid.com/)
2. Navigate to **Settings → API Keys**
3. Click **Create API Key**
4. Give it a name (e.g., "Lumiere Portal Production")
5. Select **Full Access** or **Restricted Access** with Mail Send permissions
6. Copy the API key (you'll only see it once!)

### Add to Render:
```bash
# SendGrid Configuration (Optional)
SENDGRID_API_KEY=<your_sendgrid_api_key>
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=Lumiere Student Portal
```

---

## 🔍 Optional: Error Monitoring with Sentry

For production error tracking:

### Get Sentry DSN:
1. Go to [Sentry.io](https://sentry.io/)
2. Create a project or select existing one
3. Go to **Settings → Projects → [Your Project] → Client Keys (DSN)**
4. Copy the DSN

### Add to Render:
```bash
# Sentry Error Monitoring (Optional)
SENTRY_DSN=<your_sentry_dsn>
```

---

## ⚡ Optional: Redis Rate Limiting

For enhanced rate limiting (optional, not required):

### Get Redis URL:
1. Sign up at [Redis Cloud](https://redis.com/try-free/) or [Upstash](https://upstash.com/)
2. Create a new Redis database
3. Copy the connection URL

### Add to Render:
```bash
# Redis Configuration (Optional)
REDIS_URL=redis://default:password@host:port
```

**Note:** The app works fine without Redis using in-memory rate limiting.

---

## ✅ Quick Copy-Paste Templates

### Netlify Environment Variables
```bash
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=
```

### Render Environment Variables
```bash
NODE_ENV=production
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
SUPABASE_SERVICE_KEY=
DATABASE_URL=
SESSION_SECRET=
CORS_ORIGIN=
PORT=5000
```

---

## 🚨 Security Checklist

Before deploying:

- [ ] NEVER commit `.env` file to Git
- [ ] Keep `SUPABASE_SERVICE_KEY` secret
- [ ] Generate strong `SESSION_SECRET` (min 32 characters)
- [ ] Use environment-specific URLs (don't mix dev/prod)
- [ ] Set `NODE_ENV=production` in Render
- [ ] Enable HTTPS for all URLs
- [ ] Use Session pooler for DATABASE_URL (better for serverless)
- [ ] Test all environment variables after deployment

---

## 🆘 Troubleshooting

### "Cannot connect to Supabase"
- Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct
- Check Supabase project is active
- Ensure no trailing slashes in URLs

### "Database connection failed"
- Verify `DATABASE_URL` is correct
- Ensure password is properly URL-encoded if it contains special characters
- Check you're using Session pooler URL (not Transaction pooler)

### "CORS error when calling API"
- Verify `CORS_ORIGIN` matches your Netlify URL exactly
- Ensure no trailing slashes
- Check `VITE_API_URL` in Netlify matches your Render URL

### "Session errors"
- Verify `SESSION_SECRET` is set and is at least 32 characters
- Ensure it's the same secret across all server instances

---

## 📝 Notes

1. **All URLs should NOT have trailing slashes**
   - ✅ `https://example.com`
   - ❌ `https://example.com/`

2. **Environment variables are case-sensitive**
   - Use exact casing as shown in this document

3. **Changes require redeployment**
   - After changing env vars, redeploy your services

4. **Test in staging first**
   - If possible, set up a staging environment before production

---

## 🎯 Next Steps

After setting up environment variables:

1. ✅ Deploy backend to Render
2. ✅ Deploy frontend to Netlify
3. ✅ Test the deployed application
4. ✅ Monitor logs for any errors
5. ✅ Set up email notifications (optional)
6. ✅ Configure custom domain (optional)
