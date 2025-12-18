# Deployment Checklist

## Pre-Deployment Requirements

### 1. Environment Variables Configuration

The following environment variables MUST be configured in your deployment platform:

#### Required Variables:
```
NODE_ENV=production

# Client-side Supabase (VITE_ prefix)
VITE_SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key

# Server-side Supabase
SUPABASE_URL=https://ypbzdbfqoflyszdsbivn.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key

# Database Connection
DATABASE_URL=postgresql://postgres.ypbzdbfqoflyszdsbivn:[PASSWORD]@aws-0-us-west-1.pooler.supabase.com:6543/postgres
```

#### Optional Variables:
```
# Redis (for enhanced rate limiting)
REDIS_URL=redis://username:password@host:port

# Sentry (for error monitoring)
SENTRY_DSN=your_sentry_dsn
```

### 2. Get Supabase Credentials

1. **Supabase URL & Anon Key** (for client-side):
   - Go to: https://supabase.com/dashboard/project/ypbzdbfqoflyszdsbivn/settings/api
   - Copy "Project URL" → Use for `VITE_SUPABASE_URL` and `SUPABASE_URL`
   - Copy "anon public" key → Use for `VITE_SUPABASE_ANON_KEY`

2. **Service Role Key** (for server-side):
   - Same page as above
   - Copy "service_role" key → Use for `SUPABASE_SERVICE_KEY`
   - ⚠️ WARNING: Keep this secret! Never expose in client code

3. **Database Connection String**:
   - Go to: https://supabase.com/dashboard/project/ypbzdbfqoflyszdsbivn/settings/database
   - Under "Connection string" → Select "Session pooler"
   - Copy the connection string → Use for `DATABASE_URL`
   - Replace `[YOUR-PASSWORD]` with your database password

### 3. Database Setup

Ensure all migrations are applied:
```bash
# Migrations are in: supabase/migrations/
# They should be automatically applied by Supabase
```

Check that these tables exist:
- auth.users (Supabase built-in)
- degree_programs
- courses
- program_courses
- student_program_enrollments
- support_tickets
- support_ticket_messages
- documents

### 4. Build Verification

Verify the project builds successfully:
```bash
npm run build
```

Expected output:
- ✓ Vite build completes (client bundle ~1.1MB)
- ✓ ESBuild completes (server bundle ~287KB)
- ✓ Files generated in `dist/` directory

### 5. Common Deployment Issues

#### Issue: "DATABASE_URL environment variable is not set"
**Solution**: The lazy-loading fix allows the server to start without DATABASE_URL, but you'll need it for database operations. Ensure it's set in deployment environment variables.

#### Issue: "Build fails with TypeScript errors"
**Solution**: The tsconfig.json has been updated with:
- `target: "ES2022"` for top-level await support
- `strict: false` for more lenient compilation
- `downlevelIteration: true` for iterator support

#### Issue: "Cannot find module @sentry/node"
**Solution**: Sentry is optional. The code gracefully handles its absence. To enable, install:
```bash
npm install @sentry/node @sentry/profiling-node
```

#### Issue: Large bundle size warning
**Solution**: This is expected for production builds. The warning can be safely ignored or addressed later with code splitting.

### 6. Deployment Platform Configuration

#### For Replit/Railway/Render:
1. Set all environment variables in the platform's secrets/environment section
2. Ensure the start command is: `npm start`
3. Set build command to: `npm run build`
4. Port should be automatically detected (Express listens on `process.env.PORT || 5000`)

#### For Vercel/Netlify:
These platforms require serverless deployment. Current setup is optimized for traditional Node.js hosting.

### 7. Post-Deployment Verification

After deployment, verify:
1. ✓ Application loads at deployed URL
2. ✓ Can access login page
3. ✓ Can authenticate with Supabase
4. ✓ Database queries work
5. ✓ API endpoints respond correctly

### 8. Monitoring

Monitor these endpoints:
- `GET /api/health` - Basic health check
- `GET /api/health/db` - Database connectivity
- Server logs for any errors

## Troubleshooting Deployment Errors

### Error ID Reference:
- Error IDs like `b92eb7de01af487b8fd93f10029cd18e:wxV9axE2C2fe7YAg:61616833:8507878`
- These are platform-specific deployment tracking IDs
- Share with platform support if needed

### Quick Fixes:
1. ✓ Verify all environment variables are set
2. ✓ Check build completes successfully locally
3. ✓ Ensure database migrations are applied
4. ✓ Verify Supabase project is active and accessible
5. ✓ Check deployment platform logs for specific errors
