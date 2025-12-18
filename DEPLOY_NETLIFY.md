# Deploy Frontend to Netlify

Complete step-by-step guide for deploying the Lumiere Student Portal frontend to Netlify.

---

## 📋 Prerequisites

Before starting, make sure you have:
- [ ] GitHub repository with your code
- [ ] Supabase project set up and credentials ready
- [ ] Backend deployed to Render (or backend URL ready)
- [ ] Netlify account (sign up at https://netlify.com if needed)

---

## 🚀 Step-by-Step Deployment

### Step 1: Log into Netlify

1. Go to [https://app.netlify.com/](https://app.netlify.com/)
2. Sign in with your GitHub account (recommended) or email

### Step 2: Create New Site

1. Click **"Add new site"** button
2. Select **"Import an existing project"**
3. Choose **"Deploy with GitHub"**

### Step 3: Connect GitHub Repository

1. Click **"GitHub"** as your Git provider
2. If prompted, authorize Netlify to access your GitHub account
3. Search for your repository name
4. Click on your repository to select it

### Step 4: Configure Build Settings

In the build settings screen, enter the following:

**Base directory:**
```
(leave empty - deploy from root)
```

**Build command:**
```bash
npm run build
```

**Publish directory:**
```
dist/public
```

**Important:** The publish directory must be `dist/public` because the Vite build outputs frontend files to this specific location.

### Step 5: Add Environment Variables

Before deploying, add your environment variables:

1. Scroll down to **"Environment variables"** section
2. Click **"Add environment variables"**
3. Add the following variables (one at a time):

```bash
# Variable 1
Key: VITE_SUPABASE_URL
Value: https://ypbzdbfqoflyszdsbivn.supabase.co

# Variable 2
Key: VITE_SUPABASE_ANON_KEY
Value: <paste_your_anon_key_here>

# Variable 3
Key: VITE_API_URL
Value: <your_render_backend_url>
```

**Where to get these values:**
- `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`: From Supabase Dashboard → Settings → API
- `VITE_API_URL`: Your Render backend URL (e.g., `https://lumiere-portal-api.onrender.com`)

**Important:**
- Do NOT include trailing slashes in URLs
- The anon key is safe to expose in frontend builds
- Never use the service_role key in frontend!

### Step 6: Deploy Site

1. Review all settings
2. Click **"Deploy [repository-name]"**
3. Wait for the build to complete (usually 2-5 minutes)

### Step 7: Monitor Build Process

1. You'll be redirected to the deploy log
2. Watch for any errors in the build process
3. Common issues to watch for:
   - Missing environment variables
   - Build command failures
   - TypeScript errors

### Step 8: Verify Deployment

Once the build completes:

1. Click on the generated URL (e.g., `https://random-name-123.netlify.app`)
2. Your site should load
3. Test the following:
   - Landing page loads correctly
   - Login modal opens
   - Can register a new account
   - Can log in with test credentials

---

## 🎨 Configure Custom Domain (Optional)

### Step 1: Add Custom Domain

1. Go to **Site settings → Domain management**
2. Click **"Add custom domain"**
3. Enter your domain name (e.g., `portal.yourdomain.com`)
4. Click **"Verify"**

### Step 2: Configure DNS

1. Netlify will show you DNS records to add
2. Log into your domain registrar (e.g., Namecheap, GoDaddy, Cloudflare)
3. Add the DNS records as shown:

**For subdomain (e.g., portal.yourdomain.com):**
```
Type: CNAME
Name: portal
Value: <your-site-name>.netlify.app
```

**For apex domain (e.g., yourdomain.com):**
```
Type: A
Name: @
Value: 75.2.60.5
```

### Step 3: Wait for SSL Certificate

1. Netlify will automatically provision an SSL certificate
2. This usually takes 1-2 minutes
3. Your site will be accessible via HTTPS once complete

### Step 4: Update Backend CORS

Once your custom domain is active:

1. Go to Render dashboard
2. Navigate to your backend service
3. Update the `CORS_ORIGIN` environment variable to your new domain
4. Redeploy the backend

---

## 🔧 Update Environment Variables (After Deployment)

If you need to change environment variables later:

1. Go to **Site settings → Environment variables**
2. Click **"Edit variables"**
3. Update the values
4. Click **"Save"**
5. Go to **Deploys** tab
6. Click **"Trigger deploy → Clear cache and deploy site"**

---

## 📝 Build Configuration File (Optional)

You can create a `netlify.toml` file in your project root for more control:

```toml
[build]
  command = "npm run build"
  publish = "dist/public"

[build.environment]
  NODE_VERSION = "18"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
  force = false

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "geolocation=(), microphone=(), camera=()"
```

**Note:** This is optional. Netlify works fine without this file.

---

## 🆘 Troubleshooting

### Build Fails with "Command not found"

**Problem:** Build command fails
**Solution:**
1. Verify build command is exactly: `npm run build`
2. Check package.json has a build script
3. Try clearing cache: Deploys → Trigger deploy → Clear cache and deploy

### Site Loads but Shows Blank Page

**Problem:** White screen or no content
**Solution:**
1. Check browser console for errors (F12)
2. Verify `VITE_API_URL` is set correctly
3. Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
4. Check publish directory is `dist/public` not just `dist`

### API Calls Fail with CORS Error

**Problem:** "CORS policy: No 'Access-Control-Allow-Origin' header"
**Solution:**
1. Verify backend `CORS_ORIGIN` matches your Netlify URL exactly
2. Ensure no trailing slashes in URLs
3. Redeploy backend after changing CORS_ORIGIN

### Environment Variables Not Working

**Problem:** App can't connect to Supabase or backend
**Solution:**
1. Verify variable names start with `VITE_` prefix
2. Check for typos in variable names
3. Ensure values don't have trailing spaces
4. Trigger a new deploy after adding variables

### Deploy Succeeds but 404 on Routes

**Problem:** Refreshing the page or direct URLs show 404
**Solution:**
1. Add a `_redirects` file in `public` folder:
   ```
   /*    /index.html   200
   ```
2. Or add redirect rules in netlify.toml (see above)

---

## ✅ Post-Deployment Checklist

After successful deployment:

- [ ] Site loads at Netlify URL
- [ ] Can access login page
- [ ] Can register new account
- [ ] Can log in successfully
- [ ] API calls to backend work
- [ ] No console errors in browser
- [ ] All environment variables set
- [ ] SSL certificate active (HTTPS)
- [ ] Custom domain configured (if applicable)
- [ ] Backend CORS updated with frontend URL

---

## 🎯 Next Steps

After deploying to Netlify:

1. ✅ Test all functionality thoroughly
2. ✅ Update backend CORS_ORIGIN with your Netlify URL
3. ✅ Set up custom domain (optional)
4. ✅ Configure DNS records (if using custom domain)
5. ✅ Monitor Netlify analytics
6. ✅ Set up deploy notifications (optional)
7. ✅ Create staging environment (optional)

---

## 📊 Monitoring Your Deployment

### View Deploy Logs
1. Go to **Deploys** tab
2. Click on any deploy
3. View build logs for errors or warnings

### Monitor Bandwidth
1. Go to **Analytics** tab
2. View bandwidth usage
3. Monitor visitor statistics

### Set Up Notifications
1. Go to **Site settings → Build & deploy → Deploy notifications**
2. Add notification for:
   - Deploy started
   - Deploy succeeded
   - Deploy failed
3. Choose Slack, email, or webhook

---

## 🔄 Continuous Deployment

Netlify automatically deploys when you push to GitHub:

1. Make changes to your code locally
2. Commit and push to GitHub:
   ```bash
   git add .
   git commit -m "Update feature"
   git push origin main
   ```
3. Netlify automatically detects changes
4. Builds and deploys your site
5. Receive notification when complete

### Control Deployment
- **Auto publish:** Deploy automatically on push (default)
- **Stop auto publishing:** Site settings → Build & deploy → Continuous deployment
- **Deploy previews:** Automatic for pull requests

---

## 💡 Pro Tips

1. **Deploy Previews:** Every pull request gets a preview URL
2. **Rollbacks:** Easily rollback to previous deploys
3. **Split Testing:** Test different versions with A/B testing
4. **Form Handling:** Netlify can handle form submissions
5. **Serverless Functions:** Add serverless functions if needed
6. **Analytics:** Built-in analytics available

---

## 🆘 Need Help?

- **Netlify Documentation:** https://docs.netlify.com/
- **Netlify Support:** https://www.netlify.com/support/
- **Community Forum:** https://answers.netlify.com/
- **Status Page:** https://www.netlifystatus.com/

---

**Congratulations!** Your frontend is now deployed to Netlify! 🎉
