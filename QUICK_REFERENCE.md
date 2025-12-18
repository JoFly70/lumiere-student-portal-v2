# Quick Deployment Reference Card

Fast reference for deploying Lumiere Student Portal. For detailed instructions, see DEPLOYMENT_MASTER_GUIDE.md.

---

## 🚀 Quick Start (30 Minutes)

### 1. Database (5 min)
```bash
# Go to: https://supabase.com/dashboard/project/ypbzdbfqoflyszdsbivn
# SQL Editor → New Query → Paste PRODUCTION_DATABASE_SETUP.sql → Run
```

### 2. Get Credentials (5 min)
```bash
# Supabase → Settings → API
- Copy: Project URL, anon key, service_role key

# Supabase → Settings → Database
- Copy: Connection string (Session pooler)

# Generate SESSION_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Deploy Backend (10 min)
```bash
# Go to: https://dashboard.render.com/
# New+ → Web Service → Connect GitHub repo

# Settings:
Build: npm install && npm run build
Start: npm start
```

**Environment Variables:**
```env
NODE_ENV=production
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
SUPABASE_SERVICE_KEY=<service_key>
DATABASE_URL=<connection_string>
SESSION_SECRET=<generated_secret>
CORS_ORIGIN=http://localhost:5173
PORT=5000
```

### 4. Deploy Frontend (10 min)
```bash
# Go to: https://app.netlify.com/
# Add new site → Import from GitHub

# Settings:
Build: npm run build
Publish: dist/public
```

**Environment Variables:**
```env
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_API_URL=<your_render_url>
```

### 5. Connect (2 min)
```bash
# Render → Environment → Update CORS_ORIGIN to Netlify URL
# Save (auto-redeploys)
```

### 6. Test
```bash
# Open: https://your-site.netlify.app
# Try: Register → Login → Dashboard
```

---

## 📍 Important URLs

### Dashboards
- **Supabase:** https://supabase.com/dashboard/project/ypbzdbfqoflyszdsbivn
- **Render:** https://dashboard.render.com/
- **Netlify:** https://app.netlify.com/
- **SendGrid:** https://app.sendgrid.com/ (optional)

### Your Services
- **Frontend:** `https://your-site.netlify.app`
- **Backend:** `https://your-service.onrender.com`
- **Database:** `https://ypbzdbfqoflyszdsbivn.supabase.co`

---

## 🔑 Environment Variables

### Netlify (Frontend)
```env
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_API_URL=<render_backend_url>
```

### Render (Backend)
```env
NODE_ENV=production
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=<anon_key>
SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
SUPABASE_SERVICE_KEY=<service_key>
DATABASE_URL=<connection_string>
SESSION_SECRET=<32_char_secret>
CORS_ORIGIN=<netlify_url>
PORT=5000
```

### Optional (SendGrid)
```env
SENDGRID_API_KEY=<api_key>
SENDGRID_FROM_EMAIL=noreply@yourdomain.com
SENDGRID_FROM_NAME=Lumiere Student Portal
```

---

## ⚡ Quick Commands

### Generate SESSION_SECRET
```bash
# Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# OpenSSL
openssl rand -hex 32
```

### Test Backend Health
```bash
curl https://your-backend.onrender.com/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

### View Logs
```bash
# Render: Dashboard → Service → Logs
# Netlify: Deploys → Latest → Logs
```

### Redeploy
```bash
# Render: Manual Deploy → Deploy latest commit
# Netlify: Deploys → Trigger deploy
```

---

## ✅ Verification Checklist

### Database
- [ ] 10 tables created (users, students, courses, etc.)
- [ ] RLS enabled on all tables
- [ ] Triggers and functions created

### Backend
- [ ] Build successful
- [ ] `/api/health` returns 200 OK
- [ ] All env vars set
- [ ] Logs show no errors

### Frontend
- [ ] Build successful
- [ ] Site loads
- [ ] Login modal opens
- [ ] Can register/login

### Connection
- [ ] No CORS errors
- [ ] API calls work
- [ ] Data loads in dashboard

---

## 🆘 Quick Troubleshooting

### Build Fails
```bash
# Check: package.json scripts exist
# Try: Clear cache and redeploy
# Verify: Environment variables set correctly
```

### CORS Error
```bash
# Fix: Update CORS_ORIGIN in Render to match Netlify URL exactly
# Note: No trailing slashes!
# Action: Redeploy backend
```

### Blank Page
```bash
# Check: Browser console (F12) for errors
# Verify: Publish directory is dist/public (not just dist)
# Confirm: VITE_API_URL is set in Netlify
```

### Can't Connect to Database
```bash
# Verify: DATABASE_URL is correct
# Check: Using Session pooler (not Transaction)
# Confirm: Password has no special chars (or URL-encoded)
```

### Authentication Fails
```bash
# Check: Supabase credentials correct
# Verify: SESSION_SECRET is set
# Confirm: Users table exists with RLS
```

---

## 📊 Build Settings

### Netlify
```yaml
Build command: npm run build
Publish directory: dist/public
Base directory: (empty)
Node version: 18
```

### Render
```yaml
Build command: npm install && npm run build
Start command: npm start
Environment: Node
Branch: main
Instance: Free (or Starter)
```

---

## 🔄 Update Workflow

### Code Changes
```bash
# 1. Make changes locally
# 2. Test locally: npm run dev
# 3. Commit and push to GitHub
git add .
git commit -m "Update feature"
git push origin main

# 4. Auto-deploys to Render and Netlify
# 5. Check logs for errors
```

### Environment Variable Changes
```bash
# 1. Update in dashboard (Render or Netlify)
# 2. Save changes
# 3. Redeploy service
# 4. Verify changes took effect
```

### Database Changes
```bash
# 1. Write new migration file
# 2. Test locally
# 3. Run in Supabase SQL Editor
# 4. Verify tables/policies updated
```

---

## 💰 Quick Cost Reference

### Free Tier
- Supabase: $0
- Render: $0 (750 hrs)
- Netlify: $0
- SendGrid: $0 (100 emails/day)
- **Total: $0/month**

### Production Tier
- Supabase Pro: $25
- Render Starter: $7
- Netlify Pro: $19
- SendGrid Essentials: $20
- **Total: ~$71/month**

---

## 📁 Key Files

```
PRODUCTION_DATABASE_SETUP.sql    # Complete DB schema
DEPLOYMENT_MASTER_GUIDE.md       # Detailed instructions
DEPLOY_NETLIFY.md                # Netlify guide
DEPLOY_RENDER.md                 # Render guide
SENDGRID_SETUP.md                # Email setup
ENVIRONMENT_VARIABLES.md         # All env vars
QUICK_REFERENCE.md               # This file
```

---

## 🎯 Support Links

### Documentation
- Supabase: https://supabase.com/docs
- Render: https://render.com/docs
- Netlify: https://docs.netlify.com
- SendGrid: https://docs.sendgrid.com

### Get Help
- Supabase: support@supabase.io
- Render: help@render.com
- Netlify: support@netlify.com
- SendGrid: https://support.sendgrid.com

---

## ⏱️ Time Estimates

| Task | Time |
|------|------|
| Database setup | 5 min |
| Get credentials | 5 min |
| Deploy backend | 10 min |
| Deploy frontend | 10 min |
| Connect services | 2 min |
| Test | 5 min |
| SendGrid (optional) | 15 min |
| Custom domain (optional) | 20 min |
| **Total** | **30-60 min** |

---

## 🎉 Success Indicators

When everything works:
- ✅ Health endpoint returns `{"status":"ok"}`
- ✅ Frontend loads without errors
- ✅ Can register new account
- ✅ Can login successfully
- ✅ Dashboard shows data
- ✅ No console errors
- ✅ No CORS errors

---

**Need more detail? See DEPLOYMENT_MASTER_GUIDE.md**

**Ready to deploy? Start with Step 1: Database Setup!** 🚀
