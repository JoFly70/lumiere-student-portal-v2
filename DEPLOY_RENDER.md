# Deploy Backend to Render

Complete step-by-step guide for deploying the Lumiere Student Portal backend API to Render.

---

## 📋 Prerequisites

Before starting, make sure you have:
- [ ] GitHub repository with your code
- [ ] Supabase project set up with database migrated
- [ ] Supabase credentials (URL, anon key, service key, database URL)
- [ ] SESSION_SECRET generated (32+ character random string)
- [ ] Render account (sign up at https://render.com if needed)

---

## 🚀 Step-by-Step Deployment

### Step 1: Log into Render

1. Go to [https://dashboard.render.com/](https://dashboard.render.com/)
2. Sign in with your GitHub account (recommended) or email

### Step 2: Create New Web Service

1. Click **"New +"** button in the top right
2. Select **"Web Service"**

### Step 3: Connect GitHub Repository

1. Click **"Connect account"** under GitHub (if not already connected)
2. Authorize Render to access your repositories
3. Find your repository in the list
4. Click **"Connect"** next to your repository

**If you don't see your repository:**
- Click **"Configure account"**
- Give Render access to your repository
- Return to Render and refresh

### Step 4: Configure Service Settings

Fill in the following settings:

**Name:**
```
lumiere-portal-api
```
(or any name you prefer - this will be part of your URL)

**Region:**
```
Oregon (US West)
```
(or choose the region closest to your users)

**Branch:**
```
main
```
(or your default branch name)

**Root Directory:**
```
(leave empty - deploy from root)
```

**Runtime:**
```
Node
```
(Render auto-detects this from package.json)

**Build Command:**
```bash
npm install && npm run build
```

**Start Command:**
```bash
npm start
```

**Instance Type:**
```
Free
```
(upgrade to paid plan for better performance if needed)

### Step 5: Add Environment Variables

Click **"Advanced"** to expand environment variables section.

Add the following environment variables one by one:

```bash
# Node Environment
NODE_ENV=production

# Supabase Configuration (Client-side)
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=<your_supabase_anon_key>

# Supabase Configuration (Server-side)
SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
SUPABASE_SERVICE_KEY=<your_supabase_service_role_key>

# Database Connection
DATABASE_URL=postgresql://postgres.ypbzdbfqoflyszdsbivn:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres

# Session Secret (generate using: openssl rand -hex 32)
SESSION_SECRET=<your_generated_secret_here>

# CORS Configuration (update after frontend deployment)
CORS_ORIGIN=http://localhost:5173

# Server Port
PORT=5000
```

**Important Notes:**
- Replace `<your_supabase_anon_key>` with your actual Supabase anon key
- Replace `<your_supabase_service_role_key>` with your service role key
- Replace `[YOUR-PASSWORD]` in DATABASE_URL with your actual database password
- Generate SESSION_SECRET using: `openssl rand -hex 32` or `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
- `CORS_ORIGIN` should initially be `http://localhost:5173` for testing
- After frontend deployment, update `CORS_ORIGIN` to your Netlify URL

### Step 6: Create Web Service

1. Review all settings
2. Click **"Create Web Service"**
3. Render will start building your service

### Step 7: Monitor Build Process

1. You'll be redirected to the service dashboard
2. Click on the **"Logs"** tab to watch the build
3. The build process takes 3-5 minutes
4. Watch for:
   - Dependencies installation
   - TypeScript compilation
   - Build completion
   - Server start

**Expected final log:**
```
Server running on port 5000 (production mode)
✅ Supabase credentials not configured. Database features will not work.
```
(This warning is normal if you haven't set Supabase credentials yet)

### Step 8: Verify Deployment

Once the deploy succeeds:

1. Copy your service URL (e.g., `https://lumiere-portal-api.onrender.com`)
2. Test the health endpoint in your browser:
   ```
   https://your-service-name.onrender.com/api/health
   ```
3. You should see:
   ```json
   {"status":"ok","timestamp":"2024-01-01T00:00:00.000Z"}
   ```

---

## 🔧 Update CORS After Frontend Deployment

After deploying your frontend to Netlify:

### Step 1: Get Netlify URL

1. Copy your Netlify URL (e.g., `https://lumiere-portal.netlify.app`)
2. Make sure it's the HTTPS URL, not HTTP

### Step 2: Update CORS_ORIGIN

1. Go to your Render service dashboard
2. Click on **"Environment"** tab
3. Find the `CORS_ORIGIN` variable
4. Click the pencil icon to edit
5. Replace the value with your Netlify URL:
   ```
   https://lumiere-portal.netlify.app
   ```
6. Click **"Save Changes"**

### Step 3: Trigger Redeploy

1. Render will automatically redeploy when you save environment variables
2. Wait for the redeploy to complete
3. Your backend will now accept requests from your frontend

---

## 🎨 Configure Custom Domain (Optional)

### Step 1: Add Custom Domain

1. Go to your service dashboard
2. Click on **"Settings"** tab
3. Scroll to **"Custom Domains"**
4. Click **"Add Custom Domain"**
5. Enter your domain (e.g., `api.yourdomain.com`)
6. Click **"Verify"**

### Step 2: Configure DNS

Render will show you DNS records to add:

**For subdomain (e.g., api.yourdomain.com):**
```
Type: CNAME
Name: api
Value: <your-service-name>.onrender.com
```

**For apex domain (e.g., yourdomain.com):**
You'll need to use Render's nameservers or A records (Render provides instructions)

### Step 3: Wait for SSL Certificate

1. Render automatically provisions SSL certificates
2. This usually takes 1-5 minutes
3. Your API will be accessible via HTTPS once complete

### Step 4: Update Frontend Configuration

After setting up custom domain:

1. Go to Netlify dashboard
2. Update `VITE_API_URL` environment variable
3. Set it to your new custom domain
4. Trigger a redeploy

---

## 📊 Monitor Your Service

### View Logs

1. Go to **"Logs"** tab in your service dashboard
2. View real-time logs
3. Filter by:
   - Deploy logs
   - Runtime logs
   - Error logs

### Monitor Metrics

1. Go to **"Metrics"** tab
2. View:
   - CPU usage
   - Memory usage
   - Request count
   - Response times
   - Error rates

### Set Up Alerts

1. Go to **"Settings"** tab
2. Scroll to **"Notifications"**
3. Add notifications for:
   - Deploy failures
   - Service crashes
   - High error rates
4. Choose email or Slack notifications

---

## 🔄 Automatic Deployments

Render automatically deploys when you push to GitHub:

1. Make changes to your code
2. Commit and push:
   ```bash
   git add .
   git commit -m "Update API"
   git push origin main
   ```
3. Render automatically detects changes
4. Builds and deploys your service
5. Zero-downtime deployment

### Control Auto-Deploy

1. Go to **"Settings"** tab
2. Find **"Auto-Deploy"** section
3. Toggle on/off as needed

### Manual Deploy

1. Go to **"Manual Deploy"** section
2. Click **"Deploy latest commit"**
3. Or deploy a specific branch/commit

---

## 🆘 Troubleshooting

### Build Fails with "Module not found"

**Problem:** Missing dependencies
**Solution:**
1. Verify package.json includes all dependencies
2. Try adding `--legacy-peer-deps` to build command:
   ```bash
   npm install --legacy-peer-deps && npm run build
   ```
3. Check Node version (should be 18+)

### Service Starts but Health Check Fails

**Problem:** App crashes on startup
**Solution:**
1. Check logs for error messages
2. Verify all environment variables are set correctly
3. Ensure DATABASE_URL is correct
4. Verify SESSION_SECRET is set
5. Check PORT is set to 5000

### "Cannot connect to Supabase"

**Problem:** Supabase credentials incorrect
**Solution:**
1. Verify `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are correct
2. Check for trailing spaces in environment variables
3. Ensure no trailing slashes in URLs
4. Test credentials with Supabase dashboard

### CORS Errors from Frontend

**Problem:** Frontend can't call backend API
**Solution:**
1. Verify `CORS_ORIGIN` matches your frontend URL exactly
2. Ensure no trailing slashes
3. Use HTTPS URLs for production
4. Redeploy after changing CORS_ORIGIN

### Service Keeps Restarting

**Problem:** Service crashes and restarts repeatedly
**Solution:**
1. Check logs for crash reasons
2. Verify environment variables
3. Check for syntax errors in code
4. Ensure database is accessible
5. Review memory usage (upgrade plan if needed)

### Slow Response Times

**Problem:** API is slow
**Solution:**
1. Upgrade from Free to Starter plan ($7/month)
2. Free instances spin down after inactivity
3. Paid instances are always running
4. Monitor metrics to identify bottlenecks
5. Check database query performance

---

## ✅ Post-Deployment Checklist

After successful deployment:

- [ ] Service running and healthy
- [ ] Health endpoint returns 200 OK
- [ ] All environment variables set correctly
- [ ] Database connection working
- [ ] CORS configured for frontend
- [ ] SSL certificate active (HTTPS)
- [ ] Logs show no errors
- [ ] Custom domain configured (if applicable)
- [ ] Monitoring and alerts set up
- [ ] Auto-deploy enabled

---

## 💰 Render Plans

### Free Plan
- ✅ Good for development/testing
- ⚠️ Spins down after 15 minutes of inactivity
- ⚠️ 750 hours/month limit
- ⚠️ Slower cold starts

### Starter Plan ($7/month per service)
- ✅ Always running (no spin down)
- ✅ Faster response times
- ✅ Better for production
- ✅ Custom domains included

### Recommendation
- **Development:** Use Free plan
- **Production:** Use Starter plan or higher

---

## 🔒 Security Best Practices

1. **Environment Variables**
   - Never commit secrets to Git
   - Use Render's environment variables
   - Rotate keys periodically

2. **CORS**
   - Only allow your frontend domain
   - Don't use wildcard (`*`) in production
   - Use HTTPS URLs only

3. **Database**
   - Use Session pooler for DATABASE_URL
   - Don't expose service role key in frontend
   - Enable RLS in Supabase

4. **Session Secret**
   - Use strong random string (32+ chars)
   - Never reuse across environments
   - Rotate periodically

5. **Monitoring**
   - Enable error tracking (Sentry)
   - Set up log aggregation
   - Monitor for unusual activity

---

## 🎯 Next Steps

After deploying to Render:

1. ✅ Test all API endpoints
2. ✅ Update frontend CORS_ORIGIN
3. ✅ Set up custom domain (optional)
4. ✅ Enable monitoring and alerts
5. ✅ Consider upgrading to paid plan
6. ✅ Set up staging environment
7. ✅ Configure backup strategy

---

## 📚 Useful Render Commands

### View Logs
```bash
# Install Render CLI
npm install -g @render-com/cli

# Login
render login

# View logs
render logs <service-name>
```

### SSH into Service (Paid Plans)
```bash
render ssh <service-name>
```

### Check Service Status
```bash
render services list
```

---

## 🆘 Need Help?

- **Render Documentation:** https://render.com/docs
- **Render Community:** https://community.render.com/
- **Support:** help@render.com
- **Status Page:** https://status.render.com/

---

## 💡 Pro Tips

1. **Preview Environments:** Create preview environments for PRs
2. **Background Workers:** Add background workers for async tasks
3. **Cron Jobs:** Schedule tasks with Render cron jobs
4. **Databases:** Render offers PostgreSQL hosting
5. **Redis:** Add Redis for caching and sessions
6. **Scaling:** Horizontal scaling available on higher plans

---

**Congratulations!** Your backend is now deployed to Render! 🎉

Next, deploy your frontend to Netlify and connect them together.
