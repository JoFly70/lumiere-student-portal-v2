# Manual Migration Required for Supabase Database Setup

## Summary of Automated Attempts

### Attempt 1: Direct PostgreSQL Connection Testing
Tested **18 different connection formats**:
- 2 direct connections (db.PROJECT_REF.supabase.co, PROJECT_REF.supabase.co)
- 16 pooler connections across 8 regions × 2 port types:
  - Regions: us-west-1, us-east-1, eu-west-1, eu-central-1, ap-southeast-1, ap-northeast-1, ap-south-1, sa-east-1
  - Ports: 5432 (session pooler), 6543 (transaction pooler)

**Result**: All failed with "Tenant or user not found" (error code XX000) or ENOTFOUND

### Attempt 2: Supabase Admin API via RPC
Attempted to execute SQL via `supabaseAdmin.rpc('exec_sql')` 

**Result**: Failed - `exec_sql` function does not exist in Supabase

### Root Cause Analysis
The consistent "Tenant or user not found" error across ALL connection formats suggests:
1. ❌ Database password may still be incorrect despite recent update
2. ❌ Project might have database access restrictions
3. ❌ PostgreSQL direct access may be disabled for this project tier

---

## ✅ RECOMMENDED SOLUTION: Manual Migration via Supabase SQL Editor

### Step-by-Step Instructions

#### 1. Open Supabase SQL Editor
Visit: https://supabase.com/dashboard/project/brrktoofhtcylxrundvl/editor

#### 2. Run Migration 001 (Initial Schema)
- Click "+ New query"
- Copy the entire contents of `migrations/001_initial_schema.sql`
- Paste into SQL Editor
- Click "Run" (or press Cmd/Ctrl + Enter)
- Wait for success confirmation (~15 tables + enums created)

#### 3. Run Migration 002 (RLS Policies)
- Click "+ New query" again
- Copy the entire contents of `migrations/002_rls_policies.sql`
- Paste into SQL Editor
- Click "Run"
- Wait for success confirmation (RLS enabled + policies created)

#### 4. Verify Migration Success
Run this query in SQL Editor:
```sql
SELECT 
  tablename 
FROM 
  pg_tables 
WHERE 
  schemaname = 'public'
ORDER BY 
  tablename;
```

Expected result: 15 tables including:
- users, profiles, programs, requirements
- providers, courses_catalog, articulations
- plans, plan_requirements, enrollments
- documents, metrics, payments, tasks
- coach_assignments, audit_log

---

## Next Steps After Manual Migration

Once tables are created, run these commands in Replit:

### Phase 2: Seed Database
```bash
tsx server/seed-supabase.ts
```
Expected output:
- ✓ Created 4 providers
- ✓ Created BLS program
- ✓ Created 7 requirements
- ✓ Created 30 courses
- ✓ Created 12 articulations

### Phase 3: Create Demo Student
```bash
tsx server/create-sample-student.ts
```
Expected output:
- ✓ Created auth user
- ✓ Created user profile
- ✓ Created degree plan
- ✓ Created 48 enrollments (40% progress)

### Phase 4: Test Login Flow
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@student.lumiere.app", "password": "demo123"}'
```

Then test authenticated endpoint:
```bash
curl http://localhost:5000/api/me \
  -H "Authorization: Bearer <TOKEN_FROM_LOGIN>"
```

---

## Alternative: Reset Database Password

If you want to retry automated migration:

1. Visit: https://supabase.com/dashboard/project/brrktoofhtcylxrundvl/settings/database
2. Click "Reset database password"
3. Copy the NEW password (it will be shown once)
4. Update SUPABASE_DB_PASSWORD in Replit Secrets
5. Re-run: `tsx server/run-supabase-migrations.ts`

---

## Files for Manual Migration

Location in project:
- `migrations/001_initial_schema.sql` - Creates all tables and enums
- `migrations/002_rls_policies.sql` - Sets up Row Level Security

These files are ready to copy-paste into Supabase SQL Editor.
