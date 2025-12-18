# Supabase Setup Guide for Lumiere Student Portal

## 1. Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Click "Start your project" and sign in
3. Click "New Project"
4. Fill in:
   - Name: `lumiere-student-portal`
   - Database Password: (generate a strong password and save it)
   - Region: Choose closest to your users
5. Click "Create new project" and wait for it to provision (~2 minutes)

## 2. Get Your Credentials

Once your project is ready:

1. Go to **Project Settings** (gear icon in sidebar) → **API**
2. Copy these values:
   - **Project URL** (looks like: `https://xxxxx.supabase.co`)
   - **anon/public** key (starts with `eyJ...`)
   - **service_role** key (starts with `eyJ...`) - ⚠️ Keep this secret!

## 3. Set Environment Variables in Replit

1. Click the **Secrets** tab (lock icon) in Replit sidebar
2. Add these secrets:
   ```
   SUPABASE_URL=https://xxxxx.supabase.co
   SUPABASE_ANON_KEY=eyJ... (your anon key)
   SUPABASE_SERVICE_KEY=eyJ... (your service_role key)
   DATABASE_URL=postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres
   ```
   
   Replace `[PASSWORD]` in DATABASE_URL with your database password from step 1.

## 4. Run the SQL Migration

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New query"
3. Copy and paste the entire contents of `migrations/001_initial_schema.sql`
4. Click **Run** to execute the migration
5. You should see: "Success. No rows returned"

## 5. Run the Seed Script

In Replit's Shell, run:

```bash
npm run seed
```

This will populate your database with:
- 4 providers (Sophia, Study.com, ACE, UMPI)
- 1 program (BLS - Bachelor of Liberal Studies)
- 7 distribution requirements
- 30 high-yield transfer courses
- ~50 course-to-requirement mappings

## 6. Set Up Row-Level Security (RLS)

1. In Supabase dashboard, go to **Authentication** → **Policies**
2. For each table, enable RLS and add policies:
   - Click on a table name
   - Toggle "Enable RLS" to ON
   - Click "New Policy"
   - Copy policies from `migrations/002_rls_policies.sql`

## 7. Configure Storage Buckets (REQUIRED for Document Uploads)

### Create the Storage Bucket

1. Go to **Storage** in Supabase dashboard (left sidebar)
2. Click **"New bucket"**
3. Configure:
   - **Name**: `student-documents` (exactly this name - the backend expects this)
   - **Public bucket**: **OFF** (keep it private)
   - **File size limit**: 10 MB (10485760 bytes)
   - **Allowed MIME types**: Leave empty for now (we validate in backend)
4. Click **"Create bucket"**

### Set Up Storage Policies

After creating the bucket, you need to add RLS policies so authenticated users can upload/download documents:

1. Click on the `student-documents` bucket
2. Go to **Policies** tab
3. Click **"New policy"**

**Policy 1: Allow authenticated users to upload**
- **Policy name**: `Students can upload their documents`
- **Allowed operation**: `INSERT`
- **Target roles**: `authenticated`
- **Policy definition**:
  ```sql
  (bucket_id = 'student-documents'::text)
  AND (auth.uid()::text = (storage.foldername(name))[1])
  ```
  This ensures users can only upload to their own folder (students/{student_code}/)

**Policy 2: Allow users to read their own documents**
- **Policy name**: `Users can read their own documents`
- **Allowed operation**: `SELECT`
- **Target roles**: `authenticated`
- **Policy definition**:
  ```sql
  (bucket_id = 'student-documents'::text)
  AND (auth.uid()::text = (storage.foldername(name))[1])
  ```

**Policy 3: Allow staff to read all documents**
- **Policy name**: `Staff can read all documents`
- **Allowed operation**: `SELECT`
- **Target roles**: `authenticated`
- **Policy definition**:
  ```sql
  (bucket_id = 'student-documents'::text)
  AND (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('admin', 'coach', 'staff')
    )
  )
  ```

### Configure CORS (Important!)

1. Go to **Project Settings** → **API**
2. Scroll down to **CORS Configuration**
3. Add your Replit domain to allowed origins:
   - Development: `https://*.replit.dev`
   - Production: `https://lumiereportal.app`
4. Click **"Save"**

### Test Storage Setup

After configuration, the backend will automatically:
- Generate presigned upload URLs with the bucket name
- Validate file types (PDF, JPG, PNG, HEIC only)
- Enforce 10MB file size limit
- Store files in path: `students/{student_code}/{doc_type}/{filename}`

## 8. Test the Connection

Restart your Replit application. You should see in the logs:

```
[express] serving on port 5000
✓ Supabase connected successfully
```

## Troubleshooting

**"Missing Supabase environment variables"**
- Make sure all 4 secrets are set in Replit's Secrets tab
- Restart the workflow after adding secrets

**"Connection timeout"**
- Check your DATABASE_URL has the correct password
- Verify your Supabase project is active (not paused)

**"Permission denied"**
- You may need to enable RLS policies for the tables
- Check the service_role key is correct (not anon key)

## Next Steps

Once Supabase is connected:
1. Authentication will be set up using Supabase Auth
2. All API endpoints will use the database
3. Document uploads will use Supabase Storage
4. User roles will be enforced via RLS policies
