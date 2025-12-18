/**
 * Password Verification Helper
 * Helps diagnose if SUPABASE_DB_PASSWORD is the issue
 */

const dbPassword = process.env.SUPABASE_DB_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

if (!dbPassword || !supabaseUrl) {
  console.error('❌ Missing environment variables');
  process.exit(1);
}

const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║            🔍 DATABASE PASSWORD VERIFICATION                       ║
╚═══════════════════════════════════════════════════════════════════╝

Project: ${projectRef}

Current SUPABASE_DB_PASSWORD in environment:
  Length: ${dbPassword.length} characters
  Starts with: ${dbPassword.substring(0, 3)}***
  Ends with: ***${dbPassword.substring(dbPassword.length - 3)}
  
Password character analysis:
  - Contains spaces: ${dbPassword.includes(' ') ? '❌ YES (could cause issues)' : '✅ No'}
  - Contains special chars: ${/[!@#$%^&*(),.?":{}|<>]/.test(dbPassword) ? '⚠️  YES (may need encoding)' : '✅ No'}
  - Contains quotes: ${dbPassword.includes('"') || dbPassword.includes("'") ? '❌ YES (problematic)' : '✅ No'}
  - Only alphanumeric: ${/^[a-zA-Z0-9]+$/.test(dbPassword) ? '✅ YES (safest)' : '⚠️  NO'}

URL-encoded version:
  ${encodeURIComponent(dbPassword).substring(0, 20)}...

═══════════════════════════════════════════════════════════════════

HOW TO GET THE CORRECT PASSWORD:

1. Visit: https://supabase.com/dashboard/project/${projectRef}/settings/database

2. Scroll to "Connection string" section

3. Click "URI" tab

4. You'll see something like:
   postgresql://postgres.PROJECT:YOUR_PASSWORD_HERE@aws-0-...

5. Copy ONLY the password part (after the colon, before the @)

6. Update Replit Secret:
   Key: SUPABASE_DB_PASSWORD
   Value: <paste EXACT password>

7. Restart this script

═══════════════════════════════════════════════════════════════════

ALTERNATIVE: Reset the password entirely

1. Visit: https://supabase.com/dashboard/project/${projectRef}/settings/database

2. Find "Database Password" section

3. Click "Generate a new password" or "Reset database password"

4. Copy the NEW password shown

5. Update Replit Secret with NEW password

6. Run migration script again

═══════════════════════════════════════════════════════════════════
`);
