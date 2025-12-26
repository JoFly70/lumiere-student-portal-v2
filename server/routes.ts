import type { Express } from "express";
import { createServer, type Server } from "http";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { storage } from "./storage";
import { supabaseAdmin, isSupabaseConfigured } from "./lib/supabase";
import { logger } from "./lib/logger";
import { generateRoadmap } from "./roadmap-generator";
import { db } from "./lib/db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import {
  authRateLimit,
  passwordResetRateLimit,
  signupRateLimit,
  apiRateLimit,
} from "./middleware/rate-limit";
import { generateCsrfToken, requireCsrf, deleteCsrfToken } from "./middleware/csrf";
import twoFactorRoutes from "./routes/two-factor";

// Helper to get user ID from Supabase token
async function getUserFromToken(authHeader: string | undefined): Promise<{ id: string; email: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);

  // Validate token with Supabase
  try {
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (!error && user) {
      return { id: user.id, email: user.email || '' };
    }
  } catch (error) {
    logger.warn("Failed to validate token", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  return null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function registerRoutes(app: Express): Promise<Server> {
  // Serve static files from server/public (for landing page assets)
  // In production build, esbuild bundles to dist/index.js, so __dirname is dist/
  // In development, __dirname is server/
const isProduction = process.env.NODE_ENV === 'production';
const publicPath = isProduction 
  ? path.join(process.cwd(), "public")
  : path.join(__dirname, "public");
  
  // Serve static files (images, etc.) but NOT index.html
  app.use((req, res, next) => {
    // Skip serving static files for root route - we handle it specially
    if (req.path === '/') {
      return next();
    }
    express.static(publicPath)(req, res, next);
  });
  
  // Landing page at root - public marketing page (must be before Vite catch-all)
  app.get("/", (req, res) => {
    res.sendFile(path.join(publicPath, "index.html"));
  });

  // Serve env.js with actual environment variables
  app.get("/env.js", (req, res) => {
    // Support both NEXT_PUBLIC_* and standard naming conventions
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
    
    const envJs = `// Environment configuration for frontend
window.ENV = {
  SUPABASE_URL: '${supabaseUrl}',
  SUPABASE_ANON: '${supabaseAnonKey}'
};`;
    
    res.setHeader('Content-Type', 'application/javascript');
    res.send(envJs);
  });

  // Apply general rate limiting to all API routes (100 req/15min)
  app.use("/api", apiRateLimit);

  // Sign-up endpoint - creates new user account
  // Apply strict rate limiting: 3 signups per hour per IP
  app.post("/api/auth/signup", signupRateLimit, async (req, res) => {
    try {
      const { email, password, fullName } = req.body;

      if (!email || !password || !fullName) {
        return res.status(400).json({ error: "Email, password, and full name required" });
      }

      // Validate input types
      if (typeof email !== 'string' || typeof password !== 'string' || typeof fullName !== 'string') {
        return res.status(400).json({ error: "Invalid input format" });
      }

      // Ensure Supabase is configured
      if (!isSupabaseConfigured) {
        logger.error("Sign-up attempted but Supabase not configured");
        return res.status(503).json({
          error: "Authentication service not configured"
        });
      }

      // Create user in Supabase Auth with email verification
      // NOTE: To enable email verification, set email_confirm: false
      // and configure Supabase email templates in dashboard
      const emailVerificationEnabled = process.env.ENABLE_EMAIL_VERIFICATION === 'true';

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: !emailVerificationEnabled, // Auto-confirm if verification disabled
        user_metadata: {
          full_name: fullName,
        },
      });

      if (authError) {
        logger.warn("Sign-up failed", { email, error: authError.message });
        if (authError.message.includes('already registered') || authError.message.includes('User already registered')) {
          return res.status(409).json({ error: "Email already registered" });
        }
        if (authError.message.includes('Password should be')) {
          return res.status(400).json({ error: "Password must be at least 6 characters" });
        }
        // Don't expose detailed Supabase errors - return generic message
        return res.status(400).json({ error: "Account creation failed. Please check your information and try again." });
      }

      if (!authData.user) {
        logger.error("Sign-up succeeded but no user created", { email });
        return res.status(500).json({ error: "Account creation error" });
      }

      // Create user record in our database
      const { error: userError } = await supabaseAdmin
        .from('users')
        .insert({
          id: authData.user.id,
          email,
          name: fullName,
          role: 'student'
        });

      if (userError) {
        logger.error("Failed to create user record", { email, error: userError.message });
        // Cleanup: delete auth user
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        return res.status(500).json({ error: "Failed to create user profile" });
      }

      // Create profile record - CRITICAL: must succeed for consistent state
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          user_id: authData.user.id,
          status: 'active'
        });

      if (profileError) {
        logger.error("Failed to create profile", { email, error: profileError.message });
        
        // Cleanup: rollback user record and auth user
        await supabaseAdmin.from('users').delete().eq('id', authData.user.id);
        await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
        
        return res.status(500).json({ error: "Failed to create user profile" });
      }

      // Sign in the user to get session tokens
      const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError || !signInData.session) {
        logger.error("Sign-up succeeded but auto-login failed", { email });
        return res.json({
          success: true,
          user: { id: authData.user.id, email, name: fullName },
          message: "Account created. Please log in."
        });
      }

      logger.info("User signed up", { email, userId: authData.user.id });
      
      // Return session tokens for automatic login
      return res.json({ 
        success: true, 
        user: { 
          id: authData.user.id, 
          email,
          name: fullName
        },
        session: {
          access_token: signInData.session.access_token,
          refresh_token: signInData.session.refresh_token,
          expires_at: signInData.session.expires_at
        }
      });

    } catch (error) {
      logger.error("Sign-up error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Password reset request endpoint
  // Apply rate limiting: 3 resets per hour per IP
  app.post("/api/auth/reset-password", passwordResetRateLimit, async (req, res) => {
    try{
      const { email } = req.body;

      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: "Email is required" });
      }

      // Ensure Supabase is configured
      if (!isSupabaseConfigured) {
        logger.error("Password reset attempted but Supabase not configured");
        return res.status(503).json({ error: "Service unavailable" });
      }

      // Send password reset email via Supabase
      const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, {
        redirectTo: `${process.env.APP_URL || 'http://localhost:5000'}/update-password`,
      });

      // Always return success to prevent email enumeration
      // Don't reveal whether the email exists or not
      if (error) {
        logger.warn("Password reset request failed", { email, error: error.message });
      } else {
        logger.info("Password reset email sent", { email });
      }

      return res.json({
        success: true,
        message: "If that email is registered, you will receive a password reset link"
      });

    } catch (error) {
      logger.error("Password reset error", {
        error: error instanceof Error ? error.message : String(error)
      });
      // Return success even on error to prevent email enumeration
      return res.json({
        success: true,
        message: "If that email is registered, you will receive a password reset link"
      });
    }
  });

  // Update password endpoint (after clicking reset link)
  app.post("/api/auth/update-password", async (req, res) => {
    try {
      const { password, access_token } = req.body;

      if (!password || typeof password !== 'string') {
        return res.status(400).json({ error: "Password is required" });
      }

      if (!access_token || typeof access_token !== 'string') {
        return res.status(400).json({ error: "Access token is required" });
      }

      // Ensure Supabase is configured
      if (!isSupabaseConfigured) {
        logger.error("Password update attempted but Supabase not configured");
        return res.status(503).json({ error: "Service unavailable" });
      }

      // Update password via Supabase
      const { data, error } = await supabaseAdmin.auth.updateUser(
        { password }
      );

      if (error) {
        logger.warn("Password update failed", { error: error.message });
        return res.status(400).json({ error: "Failed to update password" });
      }

      logger.info("Password updated successfully", { userId: data.user?.id });

      return res.json({
        success: true,
        message: "Password updated successfully"
      });

    } catch (error) {
      logger.error("Password update error", {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Logout endpoint - clears CSRF token
  app.post("/api/auth/logout", async (req, res) => {
    try {
      const user = await getUserFromToken(req.headers.authorization);

      if (user) {
        // Delete CSRF token if provided
        const csrfToken = req.headers['x-csrf-token'] as string;
        if (csrfToken) {
          deleteCsrfToken(user.id, csrfToken);
        }
      }

      return res.json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      logger.error("Logout error", {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Authentication endpoint
  // Apply aggressive rate limiting: 5 attempts per 15 minutes per IP
  app.post("/api/auth/login", authRateLimit, async (req, res) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: "Email and password required" });
      }

      // Validate input format
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: "Invalid input format" });
      }

      // Check if Supabase is configured
      if (!isSupabaseConfigured) {
        logger.error("Login attempted but Supabase not configured");
        return res.status(503).json({ error: "Authentication service unavailable" });
      }

      // Authenticate with Supabase
      const { data, error } = await supabaseAdmin.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.session) {
        logger.warn("Login failed", { email, reason: error?.message || "No session returned" });
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Fetch user details from users table
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email, name, role')
        .eq('id', data.user.id)
        .maybeSingle();

      if (userError) {
        logger.error("Failed to fetch user data after login", {
          userId: data.user.id,
          error: userError.message
        });
      }

      logger.info("User logged in successfully", { email, userId: data.user.id });

      return res.json({
        success: true,
        user: userData || {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name || email.split('@')[0],
          role: 'student'
        },
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at
        }
      });

    } catch (error) {
      logger.error("Login error", {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get CSRF token (requires authentication)
  app.get("/api/csrf-token", async (req, res) => {
    try {
      // Get user from auth token
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Generate CSRF token for this user
      const csrfToken = generateCsrfToken(user.id);

      return res.json({
        csrfToken,
        expiresIn: 3600, // 1 hour in seconds
      });
    } catch (error) {
      logger.error("CSRF token generation error", {
        error: error instanceof Error ? error.message : String(error)
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get current user profile and progress
  app.get("/api/me", async (req, res) => {
    try {
      // Ensure Supabase is configured
      if (!isSupabaseConfigured) {
        logger.error("API accessed but Supabase not configured");
        return res.status(503).json({ error: "Service unavailable - authentication not configured" });
      }

      // Get user ID from session token (in Authorization header)
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const token = authHeader.substring(7);

      // Verify token and get user
      const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);

      if (authError || !authUser) {
        logger.warn("Invalid auth token", { error: authError?.message });
        return res.status(401).json({ error: "Invalid or expired session" });
      }

      // Get user details from database
      logger.debug("Auth user from JWT", { 
        userId: authUser.id, 
        userIdType: typeof authUser.id,
        userIdLength: authUser.id?.length,
        email: authUser.email 
      });
      logger.debug("Querying users table", { userId: authUser.id, query: 'select id, email, name, role' });
      
      const { data: userData, error: userError } = await supabaseAdmin
        .from('users')
        .select('id, email, name, role')
        .eq('id', authUser.id)
        .single();

      logger.debug("Query result", { 
        userId: authUser.id, 
        found: !!userData, 
        errorMessage: userError?.message,
        errorCode: userError?.code,
        errorDetails: userError?.details,
        errorHint: userError?.hint
      });

      // Fallback to auth user data if database query fails (similar to login endpoint)
      const user = userData || {
        id: authUser.id,
        email: authUser.email || '',
        name: authUser.user_metadata?.name || authUser.email?.split('@')[0] || 'User',
        role: 'student' as const
      };

      if (!userData) {
        logger.warn("User not in database, using auth data", { 
          userId: authUser.id,
          email: authUser.email
        });
      }

      // Get user's plan
      const { data: planData } = await supabaseAdmin
        .from('plans')
        .select('id, program_id, catalog_year')
        .eq('user_id', authUser.id)
        .single();

      // Get progress metrics if they exist
      const { data: metricsData } = await supabaseAdmin
        .from('metrics')
        .select('*')
        .eq('user_id', authUser.id)
        .single();

      // Transform metrics from snake_case (database) to camelCase (frontend)
      const progress = metricsData ? {
        phase1Completed: metricsData.credits_phase1 || 0,
        phase1Total: 90,
        phase2Completed: metricsData.credits_residency || 0,
        phase2Total: 30,
        totalCredits: metricsData.credits_total || 0,
        currentPhase: metricsData.credits_residency > 0 ? 2 : 1
      } : {
        phase1Completed: 0,
        phase1Total: 90,
        phase2Completed: 0,
        phase2Total: 30,
        totalCredits: 0,
        currentPhase: 1
      };

      return res.json({
        user,
        plan: planData || null,
        progress
      });

    } catch (error) {
      logger.error("User profile fetch error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Flight Deck - Student progress cockpit
  app.get("/api/flight-deck", async (req, res) => {
    try {
      // Import service dynamically to avoid circular dependencies
      const { getFlightDeckData } = await import('./services/flight-deck-service.js');
      
      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      logger.info("Fetching Flight Deck data", { userId: user.id });
      
      // Get Flight Deck data
      const result = await getFlightDeckData(user.id);
      
      return res.json(result);

    } catch (error) {
      logger.error("Flight Deck fetch error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Enrollments - Course management endpoints
  
  // Get all enrollments for current user
  app.get("/api/enrollments", async (req, res) => {
    try {
      const { getUserEnrollments } = await import('./services/enrollment-service.js');
      
      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      logger.info("Fetching enrollments for user", { userId: user.id });
      const enrollments = await getUserEnrollments(user.id);
      logger.info("Enrollments fetched", { userId: user.id, count: enrollments.length });
      return res.json(enrollments);

    } catch (error) {
      logger.error("Enrollments fetch error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Failed to fetch enrollments" });
    }
  });

  // Create new enrollment
  app.post("/api/enrollments", async (req, res) => {
    try {
      const { createEnrollment } = await import('./services/enrollment-service.js');
      const { insertEnrollmentSchema } = await import('@shared/schema');

      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Validate and create enrollment
      const validatedData = insertEnrollmentSchema.parse({
        ...req.body,
        userId: user.id
      });

      const enrollment = await createEnrollment(validatedData);
      return res.status(201).json(enrollment);

    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') {
        return res.status(400).json({ error: "Invalid enrollment data" });
      }
      logger.error("Enrollment creation error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Failed to create enrollment" });
    }
  });

  // Update enrollment
  app.put("/api/enrollments/:id", async (req, res) => {
    try {
      const { updateEnrollment } = await import('./services/enrollment-service.js');
      const { id } = req.params;

      // Explicitly block userId/id/createdAt changes at route level
      // Service layer also strips userId as defense in depth
      if ('userId' in req.body || 'id' in req.body || 'createdAt' in req.body) {
        return res.status(400).json({ error: "Cannot modify userId, id, or createdAt" });
      }

      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const enrollment = await updateEnrollment(id, user.id, req.body);
      
      if (!enrollment) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      return res.json(enrollment);

    } catch (error) {
      logger.error("Enrollment update error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Failed to update enrollment" });
    }
  });

  // Delete enrollment
  app.delete("/api/enrollments/:id", async (req, res) => {
    try {
      const { deleteEnrollment } = await import('./services/enrollment-service.js');
      const { id } = req.params;

      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const success = await deleteEnrollment(id, user.id);
      
      if (!success) {
        return res.status(404).json({ error: "Enrollment not found" });
      }

      return res.status(204).send();

    } catch (error) {
      logger.error("Enrollment deletion error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Failed to delete enrollment" });
    }
  });

  // Course Templates - Predefined course lists for bulk assignment
  
  // Get all templates
  app.get("/api/templates", async (req, res) => {
    try {
      const { getAllTemplates } = await import('./services/template-service.js');
      const templates = await getAllTemplates();
      return res.json(templates);
    } catch (error) {
      logger.error("Error fetching templates", { error });
      return res.status(500).json({ error: "Failed to fetch templates" });
    }
  });

  // Get template by ID
  app.get("/api/templates/:id", async (req, res) => {
    try {
      const { getTemplateById } = await import('./services/template-service.js');
      const { id } = req.params;
      
      const template = await getTemplateById(id);
      
      if (!template) {
        return res.status(404).json({ error: "Template not found" });
      }
      
      return res.json(template);
    } catch (error) {
      logger.error("Error fetching template", { error });
      return res.status(500).json({ error: "Failed to fetch template" });
    }
  });

  // Course Assignment - Bulk assign courses to student
  
  app.post("/api/assignments", async (req, res) => {
    try {
      const { assignCoursesToStudent } = await import('./services/assignment-service.js');
      const { courses } = req.body;
      
      if (!courses || !Array.isArray(courses)) {
        return res.status(400).json({ error: "courses array required" });
      }
      
      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // Self-assignment: user assigns courses to themselves
      const result = await assignCoursesToStudent({
        userId: user.id,
        assignedBy: user.id,
        courses
      });
      
      logger.info("Courses self-assigned from template", {
        userId: user.id,
        assigned: result.length
      });
      
      return res.status(201).json({
        success: true,
        assigned: result.length,
        skipped: courses.length - result.length,
        enrollments: result
      });
    } catch (error) {
      logger.error("Error assigning courses", { error });
      return res.status(500).json({ error: "Failed to assign courses" });
    }
  });

  // Weekly Metrics - Upsert study hours for a week
  
  app.post("/api/weekly-metrics", async (req, res) => {
    try {
      const { upsertWeeklyMetrics, getWeekStart } = await import('./services/weekly-metrics-service.js');
      const { weekOf, hoursStudied, notes } = req.body;
      
      if (!weekOf || hoursStudied === undefined || hoursStudied === null) {
        return res.status(400).json({ error: "weekOf and hoursStudied required" });
      }
      
      if (typeof hoursStudied !== 'number' || hoursStudied < 0 || hoursStudied > 168) {
        return res.status(400).json({ error: "hoursStudied must be between 0 and 168" });
      }
      
      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const result = await upsertWeeklyMetrics(
        user.id,
        new Date(weekOf),
        hoursStudied,
        notes
      );
      
      logger.info("Weekly metrics upserted", {
        userId: user.id,
        weekOf,
        hoursStudied
      });
      
      return res.status(200).json(result);
    } catch (error) {
      logger.error("Error upserting weekly metrics", { error });
      return res.status(500).json({ error: "Failed to update study hours" });
    }
  });

  // Get weekly metrics for a specific week
  
  app.get("/api/weekly-metrics/:weekOf", async (req, res) => {
    try {
      const { getWeeklyMetrics } = await import('./services/weekly-metrics-service.js');
      const { weekOf } = req.params;
      
      if (!weekOf) {
        return res.status(400).json({ error: "weekOf required" });
      }
      
      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const result = await getWeeklyMetrics(user.id, new Date(weekOf));
      return res.json(result || { hoursStudied: 0 });
    } catch (error) {
      logger.error("Error getting weekly metrics", { error });
      return res.status(500).json({ error: "Failed to get study hours" });
    }
  });

  // Get recent weekly metrics (last N weeks)
  
  app.get("/api/weekly-metrics", async (req, res) => {
    try {
      const { getRecentWeeklyMetrics } = await import('./services/weekly-metrics-service.js');
      const weeksBack = parseInt(req.query.weeks as string) || 12;
      
      // Authenticate user
      const user = await getUserFromToken(req.headers.authorization);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      const result = await getRecentWeeklyMetrics(user.id, weeksBack);
      return res.json(result);
    } catch (error) {
      logger.error("Error getting recent weekly metrics", { error });
      return res.status(500).json({ error: "Failed to get study hours" });
    }
  });

  // Programs API endpoint for Supabase test
  app.get("/api/programs", async (req, res) => {
    try {
      if (!isSupabaseConfigured) {
        return res.status(503).json({ error: "Database not configured" });
      }

      const { data, error } = await supabaseAdmin
        .from('programs')
        .select('id, title, catalog_year');

      if (error) {
        logger.error("Programs fetch error", { error: error.message });
        return res.status(500).json({ error: "Failed to fetch programs" });
      }

      return res.json(data || []);
    } catch (error) {
      logger.error("Programs API error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get degree templates
  app.get("/api/degree-templates", async (req, res) => {
    try {
      if (!isSupabaseConfigured) {
        return res.status(503).json({ error: "Database not configured" });
      }

      const { data, error } = await supabaseAdmin
        .from('degree_templates')
        .select('*')
        .order('degree_name');

      if (error) {
        logger.error("Failed to fetch degree templates", { error: error.message });
        return res.status(500).json({ error: "Failed to fetch degree templates" });
      }

      return res.json(data || []);
    } catch (error) {
      logger.error("Degree templates API error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // System status check - verify simplified schema is ready
  app.get("/api/system/check", async (req, res) => {
    try {
      if (!isSupabaseConfigured) {
        return res.json({
          schema_ready: false,
          reason: "Supabase not configured"
        });
      }

      // Check if simplified schema tables exist
      const { data: templates, error } = await supabaseAdmin
        .from('degree_templates')
        .select('id')
        .limit(1);

      const schemaReady = !error && templates !== null;

      return res.json({
        schema_ready: schemaReady,
        reason: schemaReady ? "Schema initialized" : "Run migrations/003_simplified_schema.sql in Supabase SQL Editor"
      });
    } catch (error) {
      logger.error("System check error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.json({
        schema_ready: false,
        reason: "Database connection error"
      });
    }
  });

  // Generate roadmap plan (deterministic, no AI)
  app.post("/api/generate-plan", async (req, res) => {
    try {
      if (!isSupabaseConfigured) {
        return res.status(503).json({ error: "Database not configured" });
      }

      const { user_id, template_id, pace_hours_per_week, pace_months } = req.body;

      if (!user_id || !template_id) {
        return res.status(400).json({ error: "Missing user_id or template_id" });
      }

      const paceHours = pace_hours_per_week || 12;
      const paceMonths = pace_months || 12;
      
      logger.info("Generating roadmap plan", { user_id, template_id, pace_hours_per_week: paceHours, pace_months: paceMonths });

      const result = await generateRoadmap(user_id, template_id, paceHours, paceMonths);

      logger.info("Roadmap plan generated successfully", { 
        planId: result.planId, 
        totalSteps: result.steps.length,
        summary: result.summary,
        financials: result.financials
      });

      return res.json({
        plan_id: result.planId,
        summary: result.summary,
        steps: result.steps,
        financials: result.financials
      });

    } catch (error) {
      logger.error("Generate plan error", { 
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return res.status(500).json({ 
        error: "Failed to generate plan",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Get roadmap plan by ID
  app.get("/api/plans/:plan_id", async (req, res) => {
    try {
      if (!isSupabaseConfigured) {
        return res.status(503).json({ error: "Database not configured" });
      }

      const { plan_id } = req.params;

      // Fetch plan summary
      const { data: plan, error: planError } = await supabaseAdmin
        .from('roadmap_plans')
        .select('*')
        .eq('id', plan_id)
        .single();

      if (planError || !plan) {
        logger.warn("Plan not found", { plan_id, error: planError?.message });
        return res.status(404).json({ error: "Plan not found" });
      }

      // Fetch plan steps
      const { data: steps, error: stepsError } = await supabaseAdmin
        .from('roadmap_steps')
        .select('*')
        .eq('plan_id', plan_id)
        .order('step_index', { ascending: true });

      if (stepsError) {
        logger.error("Failed to fetch plan steps", { plan_id, error: stepsError.message });
        return res.status(500).json({ error: "Failed to fetch plan steps" });
      }

      // Fetch degree template for additional context
      const { data: template } = await supabaseAdmin
        .from('degree_templates')
        .select('*')
        .eq('id', plan.template_id)
        .single();

      return res.json({
        plan: {
          id: plan.id,
          user_id: plan.user_id,
          template_id: plan.template_id,
          status: plan.status,
          total_remaining_credits: plan.total_remaining_credits,
          est_cost: plan.est_cost,
          est_months: plan.est_months,
          version: plan.version,
          created_at: plan.created_at,
        },
        template: template || null,
        steps: steps || []
      });

    } catch (error) {
      logger.error("Get plan error", { 
        error: error instanceof Error ? error.message : String(error) 
      });
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Mount modular routers
  const studentsRouter = (await import('./routes/students')).default;
  const documentsRouter = (await import('./routes/documents')).default;
  const ticketsRouter = (await import('./routes/tickets')).default;
  const adminRouter = (await import('./routes/admin')).default;
  const programsRouter = (await import('./routes/programs')).default;

  app.use('/api/students', studentsRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/2fa', twoFactorRoutes);
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', programsRouter);

  const httpServer = createServer(app);

  return httpServer;
}
