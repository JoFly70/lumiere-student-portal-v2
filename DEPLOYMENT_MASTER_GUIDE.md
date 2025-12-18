# Lumiere Student Portal - Complete Deployment Guide

Your complete step-by-step guide to deploying the Lumiere Student Portal to production.

---

## 📋 Overview

This guide will walk you through deploying:
1. **Database** → Supabase (PostgreSQL with RLS)
2. **Backend API** → Render (Node.js/Express)
3. **Frontend** → Netlify (React/Vite)
4. **Email** → SendGrid (Optional)

**Total Time:** 1.5 - 2 hours for first deployment

---

## 🎯 Prerequisites

Before you begin, make sure you have:

- [ ] GitHub account with your code pushed
- [ ] Supabase account (free tier is fine)
- [ ] Netlify account (free tier is fine)
- [ ] Render account (free tier is fine)
- [ ] SendGrid account (optional, for emails)
- [ ] Terminal/command line access
- [ ] Code editor (for reviewing files)

---

## 🚀 Deployment Workflow

```
Step 1: Database Setup (Supabase)
   ↓
Step 2: Get Credentials
   ↓
Step 3: Deploy Backend (Render)
   ↓
Step 4: Deploy Frontend (Netlify)
   ↓
Step 5: Connect Everything
   ↓
Step 6: Test & Verify
   ↓
Step 7: Email Setup (Optional)
```

---

## 📅 Step-by-Step Instructions

### STEP 1: Set Up Database (15 minutes)

#### 1.1 Access Supabase

1. Go to [https://supabase.com/dashboard](https://supabase.com/dashboard)
2. Sign in or create account
3. You should see your project: `ypbzdbfqoflyszdsbivn`

#### 1.2 Run Database Migration

1. In Supabase, go to **SQL Editor** (left sidebar)
2. Click **"New Query"**
3. Open the file: `PRODUCTION_DATABASE_SETUP.sql` from your project
4. Copy the ENTIRE contents
5. Paste into Supabase SQL Editor
6. Click **"Run"** (or press Cmd/Ctrl + Enter)
7. Wait for completion (30-60 seconds)
8. You should see success message: "Lumiere Student Portal Database Setup Complete!"

#### 1.3 Verify Tables Created

1. In Supabase, go to **Table Editor** (left sidebar)
2. You should see these tables:
   - users
   - students
   - degree_programs
   - courses
   - program_courses
   - student_program_enrollments
   - documents
   - support_tickets
   - ticket_comments
   - weekly_metrics

**If you see all 10 tables, you're good to go!** ✅

---

### STEP 2: Gather Credentials (10 minutes)

You need to collect several credentials before deploying.

#### 2.1 Supabase Credentials

1. In Supabase Dashboard, go to **Settings → API**
2. Copy these values:
   - **Project URL** (e.g., `https://ypbzdbfqoflyszdsbivn.supabase.co`)
   - **anon public** key (safe to expose)
   - **service_role** key (keep secret!)

3. Go to **Settings → Database**
4. Find **Connection string** section
5. Select **Session pooler** (recommended)
6. Copy the connection string
7. Replace `[YOUR-PASSWORD]` with your database password

**Save these in a text file - you'll need them soon!**

#### 2.2 Generate SESSION_SECRET

Generate a random 32-character secret:

**Option 1: Using Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option 2: Using OpenSSL**
```bash
openssl rand -hex 32
```

**Option 3: Online**
Go to [https://www.random.org/strings/](https://www.random.org/strings/) and generate a 64-char alphanumeric string

**Save this secret!**

---

### STEP 3: Deploy Backend to Render (20 minutes)

#### 3.1 Create Render Service

1. Go to [https://dashboard.render.com/](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Click **"Connect"** next to your repo

#### 3.2 Configure Service

**Name:** `lumiere-portal-api` (or your choice)
**Region:** `Oregon (US West)` (or closest to you)
**Branch:** `main`
**Build Command:** `npm install && npm run build`
**Start Command:** `npm start`
**Instance Type:** `Free` (upgrade later if needed)

#### 3.3 Add Environment Variables

Click **"Advanced"** and add these variables:

```bash
NODE_ENV=production
VITE_SUPABASE_URL=<paste_supabase_project_url>
VITE_SUPABASE_ANON_KEY=<paste_anon_key>
SUPABASE_URL=<paste_supabase_project_url>
SUPABASE_SERVICE_KEY=<paste_service_role_key>
DATABASE_URL=<paste_connection_string>
SESSION_SECRET=<paste_generated_secret>
CORS_ORIGIN=http://localhost:5173
PORT=5000
```

**Important:**
- Use the credentials you gathered in Step 2
- `CORS_ORIGIN` will be updated later with your Netlify URL
- No trailing slashes in URLs!

#### 3.4 Deploy

1. Click **"Create Web Service"**
2. Wait for build to complete (3-5 minutes)
3. Watch the logs for errors

#### 3.5 Test Backend

1. Copy your Render URL (e.g., `https://lumiere-portal-api.onrender.com`)
2. Open in browser: `https://your-url.onrender.com/api/health`
3. You should see: `{"status":"ok","timestamp":"..."}`

**If you see this, backend is working!** ✅

---

### STEP 4: Deploy Frontend to Netlify (20 minutes)

#### 4.1 Create Netlify Site

1. Go to [https://app.netlify.com/](https://app.netlify.com/)
2. Click **"Add new site"** → **"Import an existing project"**
3. Choose **"GitHub"**
4. Find and select your repository

#### 4.2 Configure Build Settings

**Build command:** `npm run build`
**Publish directory:** `dist/public`
**Base directory:** (leave empty)

#### 4.3 Add Environment Variables

Before deploying, add these variables:

```bash
VITE_SUPABASE_URL=<paste_supabase_project_url>
VITE_SUPABASE_ANON_KEY=<paste_anon_key>
VITE_API_URL=<paste_your_render_url>
```

**Important:**
- `VITE_API_URL` is your Render URL from Step 3
- No trailing slashes!
- Use HTTPS URLs

#### 4.4 Deploy

1. Click **"Deploy site"**
2. Wait for build (3-5 minutes)
3. Watch for any build errors

#### 4.5 Test Frontend

1. Copy your Netlify URL (e.g., `https://random-name-123.netlify.app`)
2. Open in browser
3. You should see the landing page

**If the page loads, frontend is deployed!** ✅

---

### STEP 5: Connect Frontend and Backend (10 minutes)

#### 5.1 Update Backend CORS

1. Go back to Render dashboard
2. Open your backend service
3. Go to **"Environment"** tab
4. Find `CORS_ORIGIN` variable
5. Update it to your Netlify URL: `https://your-site.netlify.app`
6. Save (Render will auto-redeploy)

#### 5.2 Wait for Redeploy

1. Wait 2-3 minutes for Render to redeploy
2. Check logs to ensure no errors

---

### STEP 6: Test Everything (15 minutes)

#### 6.1 Test User Registration

1. Open your Netlify URL
2. Click on Login/Sign Up
3. Try registering a new account:
   - Email: `test@example.com`
   - Password: `Test123!@#`
   - Name: `Test User`
4. Submit the form

**If registration works, congratulations!** 🎉

#### 6.2 Test Login

1. Log in with your test account
2. You should see the dashboard
3. Check that data loads correctly

#### 6.3 Test API Connection

1. Open browser developer tools (F12)
2. Go to Console tab
3. Look for any red errors
4. Network tab should show successful API calls (status 200)

#### 6.4 Common Issues

**"Network Error" or CORS error:**
- Check that CORS_ORIGIN matches Netlify URL exactly
- Ensure no trailing slashes
- Redeploy backend if needed

**"Cannot connect to Supabase":**
- Verify Supabase credentials in both Netlify and Render
- Check for typos
- Ensure no extra spaces

**Page is blank:**
- Check browser console for errors
- Verify VITE_API_URL is set correctly
- Check publish directory is `dist/public`

---

### STEP 7: Email Setup with SendGrid (Optional - 15 minutes)

If you want email functionality:

#### 7.1 Create SendGrid Account

1. Go to [https://sendgrid.com/](https://sendgrid.com/)
2. Sign up for free account
3. Verify your email

#### 7.2 Create API Key

1. Go to **Settings → API Keys**
2. Click **"Create API Key"**
3. Name: `Lumiere Portal Production`
4. Permissions: `Full Access`
5. Copy the key (you'll only see it once!)

#### 7.3 Verify Sender

1. Go to **Settings → Sender Authentication**
2. Click **"Verify a Single Sender"**
3. Fill in your details
4. Use: `noreply@yourdomain.com` (or your email)
5. Check email and verify

#### 7.4 Add to Render

1. Go to Render dashboard
2. Add these environment variables:

```bash
SENDGRID_API_KEY=<paste_api_key>
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=Lumiere Student Portal
```

3. Save (Render will redeploy)

#### 7.5 Test Email

1. Try "Forgot Password" feature
2. Check if you receive the email
3. Check SendGrid dashboard for activity

**See SENDGRID_SETUP.md for detailed instructions**

---

## ✅ Deployment Checklist

### Database Setup
- [ ] Supabase project accessed
- [ ] SQL migration file run successfully
- [ ] All 10 tables created
- [ ] RLS policies enabled

### Backend Deployment
- [ ] Render service created
- [ ] All environment variables set
- [ ] Build successful
- [ ] Service running
- [ ] Health check passes
- [ ] CORS configured

### Frontend Deployment
- [ ] Netlify site created
- [ ] Build settings configured
- [ ] Environment variables set
- [ ] Build successful
- [ ] Site accessible
- [ ] API connection working

### Testing
- [ ] User registration works
- [ ] User login works
- [ ] Dashboard loads
- [ ] API calls successful
- [ ] No console errors
- [ ] No CORS errors

### Optional
- [ ] SendGrid configured
- [ ] Test email sent
- [ ] Custom domain set up
- [ ] SSL certificates active

---

## 🎨 Custom Domain Setup (Optional)

### Frontend (Netlify)

1. In Netlify, go to **Domain settings**
2. Add your domain (e.g., `portal.yourdomain.com`)
3. Add DNS record at your domain registrar:
   ```
   Type: CNAME
   Name: portal
   Value: <your-site>.netlify.app
   ```
4. Wait for SSL certificate (automatic)

### Backend (Render)

1. In Render, go to **Settings → Custom Domains**
2. Add your domain (e.g., `api.yourdomain.com`)
3. Add DNS record:
   ```
   Type: CNAME
   Name: api
   Value: <your-service>.onrender.com
   ```
4. Wait for SSL certificate

### Update CORS

After custom domains:
1. Update `CORS_ORIGIN` in Render to your new frontend domain
2. Update `VITE_API_URL` in Netlify to your new backend domain
3. Redeploy both services

---

## 🔍 Monitoring & Maintenance

### Check Logs Regularly

**Render Logs:**
1. Go to your service
2. Click **"Logs"** tab
3. Look for errors or warnings

**Netlify Logs:**
1. Go to **Deploys**
2. Click on latest deploy
3. View build and function logs

### Monitor Performance

**Render Metrics:**
- CPU usage
- Memory usage
- Response times
- Error rates

**Netlify Analytics:**
- Page views
- Bandwidth
- Build times

### Set Up Alerts

**Render:**
1. Go to **Settings → Notifications**
2. Add email or Slack alerts for:
   - Deploy failures
   - Service crashes
   - High error rates

**Netlify:**
1. Go to **Settings → Build & deploy → Deploy notifications**
2. Add notifications for:
   - Deploy started
   - Deploy succeeded
   - Deploy failed

---

## 🆘 Troubleshooting Guide

### Problem: Build fails on Netlify
**Solutions:**
- Check build logs for specific error
- Verify package.json has correct scripts
- Try: `npm run build` locally first
- Clear cache and redeploy

### Problem: Backend crashes on Render
**Solutions:**
- Check logs for error message
- Verify all environment variables set
- Ensure DATABASE_URL is correct
- Check NODE_ENV is set to production

### Problem: Can't connect to database
**Solutions:**
- Verify DATABASE_URL format
- Use Session pooler URL (not Transaction)
- Check database password is correct
- Ensure RLS policies are set

### Problem: CORS errors
**Solutions:**
- Verify CORS_ORIGIN matches frontend URL exactly
- No trailing slashes in URLs
- Use HTTPS in production
- Redeploy backend after changing CORS

### Problem: Authentication not working
**Solutions:**
- Check Supabase credentials
- Verify SESSION_SECRET is set
- Ensure users table exists
- Check RLS policies

---

## 💰 Cost Breakdown

### Free Tier (Development/Testing)
- **Supabase:** Free (500MB database, 2GB bandwidth)
- **Render:** Free (750 hours/month, spins down after inactivity)
- **Netlify:** Free (100GB bandwidth, 300 build minutes)
- **SendGrid:** Free (100 emails/day)
- **Total:** $0/month

### Production Tier (Recommended)
- **Supabase Pro:** $25/month (8GB database, 50GB bandwidth)
- **Render Starter:** $7/month (always-on, faster)
- **Netlify Pro:** $19/month (more bandwidth, analytics)
- **SendGrid Essentials:** $20/month (50k emails)
- **Total:** ~$71/month

### Scale Tier (Growing Business)
- **Supabase Pro:** $25/month
- **Render Standard:** $25/month (more power)
- **Netlify Business:** $99/month (advanced features)
- **SendGrid Pro:** $90/month (100k emails)
- **Total:** ~$239/month

---

## 📚 Additional Resources

### Documentation
- **Supabase Docs:** https://supabase.com/docs
- **Render Docs:** https://render.com/docs
- **Netlify Docs:** https://docs.netlify.com
- **SendGrid Docs:** https://docs.sendgrid.com

### Support
- **Supabase Support:** support@supabase.io
- **Render Support:** help@render.com
- **Netlify Support:** support@netlify.com
- **SendGrid Support:** https://support.sendgrid.com

### Community
- **Supabase Discord:** https://discord.supabase.com
- **Render Community:** https://community.render.com
- **Netlify Forums:** https://answers.netlify.com

---

## 🎯 Next Steps After Deployment

1. **Set up monitoring**
   - Configure error tracking (Sentry)
   - Set up uptime monitoring
   - Enable analytics

2. **Improve security**
   - Enable 2FA for admin accounts
   - Review RLS policies
   - Rotate secrets regularly

3. **Optimize performance**
   - Set up CDN
   - Enable caching
   - Optimize database queries

4. **Create backups**
   - Set up database backups
   - Document recovery procedures
   - Test restore process

5. **User testing**
   - Invite beta users
   - Gather feedback
   - Fix issues

6. **Launch**
   - Announce to users
   - Monitor closely
   - Be ready to respond to issues

---

## 🎉 Congratulations!

You've successfully deployed the Lumiere Student Portal to production!

Your application is now:
- ✅ Live and accessible on the internet
- ✅ Using a production database
- ✅ Secured with RLS policies
- ✅ Backed by professional hosting
- ✅ Ready for real users

**Remember:**
- Monitor logs regularly
- Back up your database
- Keep dependencies updated
- Respond to user feedback
- Scale as you grow

**Good luck with your launch!** 🚀

---

For detailed instructions on specific topics, see:
- **DEPLOY_NETLIFY.md** - Detailed Netlify setup
- **DEPLOY_RENDER.md** - Detailed Render setup
- **SENDGRID_SETUP.md** - Email configuration
- **ENVIRONMENT_VARIABLES.md** - All environment variables
- **PRODUCTION_DATABASE_SETUP.sql** - Complete database schema
