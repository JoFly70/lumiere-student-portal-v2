import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, boolean, jsonb, pgEnum, index, uniqueIndex, date, smallint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const roleEnum = pgEnum("role", ["student", "coach", "admin"]);
export const statusEnum = pgEnum("status", ["active", "inactive", "pending", "archived"]);
export const enrollmentStatusEnum = pgEnum("enrollment_status", ["todo", "in_progress", "completed", "dropped"]);
export const enrollmentSourceEnum = pgEnum("enrollment_source_enum", ["self", "advisor"]);
export const pricingModelEnum = pgEnum("pricing_model_enum", [
  "subscription", 
  "per_session", 
  "per_course", 
  "per_credit", 
  "hybrid"
]);
export const documentStatusEnum = pgEnum("document_status", ["pending", "parsed", "approved", "rejected"]);
export const paymentStatusEnum = pgEnum("payment_status", ["pending", "paid", "failed", "refunded"]);
export const taskStatusEnum = pgEnum("task_status", ["pending", "in_progress", "completed", "cancelled"]);

// Student profile enums (using different names to avoid conflict with Zod enums)
export const studentStatusDbEnum = pgEnum("student_status_enum", ["lead", "active", "paused", "graduated"]);
export const residencyDbEnum = pgEnum("residency_enum", ["us", "foreign"]);
export const hsPathDbEnum = pgEnum("hs_path_enum", ["local_diploma", "ged", "foreign"]);
export const targetPaceDbEnum = pgEnum("target_pace_enum", ["fast", "standard", "extended"]);
export const contactTypeDbEnum = pgEnum("contact_type_enum", ["parent", "spouse", "guardian", "other"]);
export const docTypeDbEnum = pgEnum("doc_type_enum", ["id_gov", "hs_diploma", "hs_transcript", "degree_certificate", "college_transcript", "foreign_eval", "english_cert", "residency_doc", "consent_form", "other"]);
export const docStatusDbEnum = pgEnum("doc_status_enum", ["pending", "verified", "rejected", "resubmit_requested"]);
export const visibilityDbEnum = pgEnum("visibility_enum", ["student_staff", "staff_only", "public"]);
export const englishProofTypeDbEnum = pgEnum("english_proof_type_enum", ["duolingo", "ielts", "toefl", "cambridge", "lumiere_placement"]);

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: roleEnum("role").notNull().default("student"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex("users_email_idx").on(table.email),
}));

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Profiles table
export const profiles = pgTable("profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone"),
  phone: text("phone"),
  status: statusEnum("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: uniqueIndex("profiles_user_id_idx").on(table.userId),
}));

export const insertProfileSchema = createInsertSchema(profiles).omit({ id: true, createdAt: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profiles.$inferSelect;

// Students table (Drizzle ORM definition - matches migration 005)
export const studentsTable = pgTable("students", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  user_id: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  student_code: text("student_code").notNull().unique(),
  status: studentStatusDbEnum("status").notNull().default("lead"),
  
  // Identity
  first_name: text("first_name").notNull(),
  middle_name: text("middle_name"),
  last_name: text("last_name").notNull(),
  preferred_name: text("preferred_name"),
  dob: date("dob").notNull(),
  sex: text("sex"),
  nationality: text("nationality").array().notNull().default(sql`'{}'::text[]`),
  gov_id_type: text("gov_id_type"),
  gov_id_number: text("gov_id_number"),
  photo_url: text("photo_url"),
  
  // Residency & Eligibility
  residency: residencyDbEnum("residency").notNull(),
  hs_completion: boolean("hs_completion").notNull().default(false),
  hs_path: hsPathDbEnum("hs_path"),
  hs_country: text("hs_country"),
  hs_school: text("hs_school"),
  hs_year: smallint("hs_year"),
  hs_doc_url: text("hs_doc_url"),
  
  // Contact Information
  email: text("email").notNull().unique(),
  email_verified_at: timestamp("email_verified_at"),
  phone_primary: text("phone_primary").notNull(),
  phone_secondary: text("phone_secondary"),
  whatsapp_primary: boolean("whatsapp_primary").notNull().default(false),
  timezone: text("timezone"),
  preferred_contact_channel: text("preferred_contact_channel").default("email"),
  
  // Address
  address_country: text("address_country").notNull(),
  address_state: text("address_state"),
  address_city: text("address_city"),
  address_postal: text("address_postal"),
  address_line1: text("address_line1").notNull(),
  address_line2: text("address_line2"),
  
  // Program Intent
  target_degree: text("target_degree"),
  target_major: text("target_major"),
  start_term: date("start_term"),
  prior_credits: boolean("prior_credits").notNull().default(false),
  prior_credits_est: smallint("prior_credits_est"),
  prior_sources: text("prior_sources").array().notNull().default(sql`'{}'::text[]`),
  transcripts_url: text("transcripts_url").array().notNull().default(sql`'{}'::text[]`),
  target_pace: targetPaceDbEnum("target_pace"),
  
  // Compliance
  marketing_opt_in: boolean("marketing_opt_in").notNull().default(false),
  media_release: boolean("media_release").notNull().default(false),
  consent_signed_at: timestamp("consent_signed_at"),
  consent_signature: text("consent_signature"),
  
  // Metadata
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("students_user_id_idx").on(table.user_id),
  studentCodeIdx: uniqueIndex("students_student_code_idx").on(table.student_code),
  emailIdx: uniqueIndex("students_email_idx").on(table.email),
}));

// Drizzle-generated schemas for students table
export const insertStudentsTableSchema = createInsertSchema(studentsTable).omit({ 
  id: true, 
  student_code: true,
  created_at: true, 
  updated_at: true,
  email_verified_at: true,
  consent_signed_at: true
});
export type StudentsTableInsert = z.infer<typeof insertStudentsTableSchema>;
export type StudentsTableSelect = typeof studentsTable.$inferSelect;

// Student contacts table (Drizzle ORM definition)
export const studentContactsTable = pgTable("student_contacts", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  student_id: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  type: contactTypeDbEnum("type").notNull(),
  full_name: text("full_name").notNull(),
  relationship: text("relationship").notNull(),
  phone: text("phone").notNull(),
  email: text("email"),
  language: text("language"),
  scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
  consent_doc_url: text("consent_doc_url"),
  created_at: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  studentIdIdx: index("idx_student_contacts_student_id").on(table.student_id),
  typeIdx: index("idx_student_contacts_type").on(table.type),
}));

export const insertStudentContactsTableSchema = createInsertSchema(studentContactsTable).omit({ 
  id: true,
  created_at: true,
});
export type StudentContactsTableInsert = z.infer<typeof insertStudentContactsTableSchema>;
export type StudentContactsTableSelect = typeof studentContactsTable.$inferSelect;

// Student English proof table (Drizzle ORM definition)
export const studentEnglishProofTable = pgTable("student_english_proof", {
  id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
  student_id: text("student_id").notNull().references(() => studentsTable.id, { onDelete: "cascade" }),
  proof_type: englishProofTypeDbEnum("proof_type").notNull(),
  score: integer("score").notNull(), // numeric → integer for simplicity
  test_date: date("test_date").notNull(),
  issuer: text("issuer"),
  test_id: text("test_id"),
  meets_requirement: boolean("meets_requirement").notNull().default(false),
  doc_url: text("doc_url"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  studentIdIdx: index("idx_student_english_student_id").on(table.student_id),
  proofTypeIdx: index("idx_student_english_proof_type").on(table.proof_type),
  uniqueStudent: uniqueIndex("unique_student_english").on(table.student_id),
}));

export const insertStudentEnglishProofTableSchema = createInsertSchema(studentEnglishProofTable).omit({ 
  id: true,
  created_at: true,
  updated_at: true,
  meets_requirement: true, // Computed by trigger
});
export type StudentEnglishProofTableInsert = z.infer<typeof insertStudentEnglishProofTableSchema>;
export type StudentEnglishProofTableSelect = typeof studentEnglishProofTable.$inferSelect;

// Programs table
export const programs = pgTable("programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  catalogYear: integer("catalog_year").notNull(),
  residencyRequired: integer("residency_required").notNull().default(30),
  ulRequired: integer("ul_required").notNull().default(24),
  totalRequired: integer("total_required").notNull().default(120),
  rules: jsonb("rules").notNull().default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertProgramSchema = createInsertSchema(programs).omit({ id: true, createdAt: true });
export type InsertProgram = z.infer<typeof insertProgramSchema>;
export type Program = typeof programs.$inferSelect;

// Requirements table (distribution buckets)
export const requirements = pgTable("requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  programId: varchar("program_id").notNull().references(() => programs.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  title: text("title").notNull(),
  area: text("area").notNull(),
  minCredits: integer("min_credits").notNull(),
  maxCredits: integer("max_credits"),
  isUpperLevel: boolean("is_upper_level").notNull().default(false),
  sequence: integer("sequence").notNull().default(0),
  meta: jsonb("meta").default('{}'),
}, (table) => ({
  programIdIdx: index("requirements_program_id_idx").on(table.programId),
}));

export const insertRequirementSchema = createInsertSchema(requirements).omit({ id: true });
export type InsertRequirement = z.infer<typeof insertRequirementSchema>;
export type Requirement = typeof requirements.$inferSelect;

// Providers table
export const providers = pgTable("providers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
}, (table) => ({
  keyIdx: uniqueIndex("providers_key_idx").on(table.key),
}));

export const insertProviderSchema = createInsertSchema(providers).omit({ id: true });
export type InsertProvider = z.infer<typeof insertProviderSchema>;
export type Provider = typeof providers.$inferSelect;

// Courses catalog table
export const coursesCatalog = pgTable("courses_catalog", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: varchar("provider_id").notNull().references(() => providers.id),
  code: text("code").notNull(),
  title: text("title").notNull(),
  credits: integer("credits").notNull(),
  level: text("level").notNull().default("lower"),
  active: boolean("active").notNull().default(true),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  meta: jsonb("meta").default('{}'),
}, (table) => ({
  providerCodeIdx: uniqueIndex("courses_catalog_provider_code_idx").on(table.providerId, table.code),
  activeIdx: index("courses_catalog_active_idx").on(table.active),
}));

export const insertCoursesCatalogSchema = createInsertSchema(coursesCatalog).omit({ id: true });
export type InsertCoursesCatalog = z.infer<typeof insertCoursesCatalogSchema>;
export type CoursesCatalog = typeof coursesCatalog.$inferSelect;

// Articulations table (course mappings)
export const articulations = pgTable("articulations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromCourseId: varchar("from_course_id").notNull().references(() => coursesCatalog.id),
  toRequirementId: varchar("to_requirement_id").notNull().references(() => requirements.id),
  priority: integer("priority").notNull().default(0),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  notes: text("notes"),
}, (table) => ({
  fromCourseIdx: index("articulations_from_course_idx").on(table.fromCourseId),
  toRequirementIdx: index("articulations_to_requirement_idx").on(table.toRequirementId),
  requirementPriorityIdx: index("articulations_req_priority_idx").on(table.toRequirementId, table.priority),
}));

export const insertArticulationSchema = createInsertSchema(articulations).omit({ id: true });
export type InsertArticulation = z.infer<typeof insertArticulationSchema>;
export type Articulation = typeof articulations.$inferSelect;

// Plans table
export const plans = pgTable("plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  programId: varchar("program_id").notNull().references(() => programs.id),
  catalogYear: integer("catalog_year").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lockedAt: timestamp("locked_at"),
}, (table) => ({
  userIdIdx: index("plans_user_id_idx").on(table.userId),
  userProgramIdx: uniqueIndex("plans_user_program_idx").on(table.userId, table.programId),
}));

export const insertPlanSchema = createInsertSchema(plans).omit({ id: true, createdAt: true });
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Plan = typeof plans.$inferSelect;

// Plan requirements table
export const planRequirements = pgTable("plan_requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  requirementId: varchar("requirement_id").notNull().references(() => requirements.id),
  status: text("status").notNull().default("pending"),
  satisfiedCredits: integer("satisfied_credits").notNull().default(0),
  detail: jsonb("detail").default('{}'),
}, (table) => ({
  planIdIdx: index("plan_requirements_plan_id_idx").on(table.planId),
  planRequirementIdx: uniqueIndex("plan_requirements_plan_req_idx").on(table.planId, table.requirementId),
}));

export const insertPlanRequirementSchema = createInsertSchema(planRequirements).omit({ id: true });
export type InsertPlanRequirement = z.infer<typeof insertPlanRequirementSchema>;
export type PlanRequirement = typeof planRequirements.$inferSelect;

// Enrollments table (extended for Course Roadmap)
export const enrollments = pgTable("enrollments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  providerId: varchar("provider_id").notNull().references(() => providers.id),
  courseId: varchar("course_id").references(() => coursesCatalog.id),
  title: text("title").notNull(),
  credits: integer("credits").notNull(),
  status: enrollmentStatusEnum("status").notNull().default("todo"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  proofUri: text("proof_uri"), // DEPRECATED: Use proof_url instead
  // Course Roadmap extensions (migration 007)
  courseCode: text("course_code"),
  courseUrl: text("course_url"),
  notes: text("notes"),
  source: enrollmentSourceEnum("source").default("self"),
  assignedBy: varchar("assigned_by").references(() => users.id),
  assignedAt: timestamp("assigned_at"),
  proofUrl: text("proof_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdStatusIdx: index("enrollments_user_id_status_idx").on(table.userId, table.status),
  userCourseIdx: uniqueIndex("enrollments_user_course_idx").on(table.userId, table.courseId),
  sourceIdx: index("idx_enrollments_source").on(table.source),
  assignedByIdx: index("idx_enrollments_assigned_by").on(table.assignedBy),
}));

export const insertEnrollmentSchema = createInsertSchema(enrollments).omit({ id: true, createdAt: true });
export type InsertEnrollment = z.infer<typeof insertEnrollmentSchema>;
export type Enrollment = typeof enrollments.$inferSelect;

export const courseTemplates = pgTable("course_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  isDefault: boolean("is_default").notNull().default(false),
  courses: jsonb("courses").notNull().default('[]'),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  nameIdx: index("course_templates_name_idx").on(table.name),
  defaultIdx: index("course_templates_default_idx").on(table.isDefault),
}));

export const insertCourseTemplateSchema = createInsertSchema(courseTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCourseTemplate = z.infer<typeof insertCourseTemplateSchema>;
export type CourseTemplate = typeof courseTemplates.$inferSelect;

// Documents table
export const documents = pgTable("documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  uri: text("uri").notNull(),
  parsedJson: jsonb("parsed_json").default('{}'),
  status: documentStatusEnum("status").notNull().default("pending"),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
}, (table) => ({
  userIdStatusIdx: index("documents_user_id_status_idx").on(table.userId, table.status),
}));

export const insertDocumentSchema = createInsertSchema(documents).omit({ id: true, uploadedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documents.$inferSelect;

// Metrics table
export const metrics = pgTable("metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: varchar("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
  creditsTotal: integer("credits_total").notNull().default(0),
  creditsPhase1: integer("credits_phase1").notNull().default(0),
  creditsResidency: integer("credits_residency").notNull().default(0),
  creditsUl: integer("credits_ul").notNull().default(0),
  pctComplete: integer("pct_complete").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: uniqueIndex("metrics_user_id_idx").on(table.userId),
  planIdIdx: uniqueIndex("metrics_plan_id_idx").on(table.planId),
}));

export const insertMetricSchema = createInsertSchema(metrics).omit({ id: true });
export type InsertMetric = z.infer<typeof insertMetricSchema>;
export type Metric = typeof metrics.$inferSelect;

// Payments table
export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id"),
  invoiceId: text("invoice_id"),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("usd"),
  status: paymentStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("payments_user_id_idx").on(table.userId),
}));

export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof payments.$inferSelect;

// Tasks table
export const tasks = pgTable("tasks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedBy: varchar("assigned_by").references(() => users.id),
  title: text("title").notNull(),
  dueAt: timestamp("due_at"),
  status: taskStatusEnum("status").notNull().default("pending"),
  meta: jsonb("meta").default('{}'),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdStatusIdx: index("tasks_user_id_status_idx").on(table.userId, table.status),
}));

export const insertTaskSchema = createInsertSchema(tasks).omit({ id: true, createdAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;

// Coach assignments table (defines which coaches are assigned to which students)
export const coachAssignments = pgTable("coach_assignments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coachId: varchar("coach_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  studentId: varchar("student_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assignedAt: timestamp("assigned_at").notNull().defaultNow(),
}, (table) => ({
  coachStudentIdx: uniqueIndex("coach_assignments_coach_student_idx").on(table.coachId, table.studentId),
  studentIdx: index("coach_assignments_student_idx").on(table.studentId),
}));

export const insertCoachAssignmentSchema = createInsertSchema(coachAssignments).omit({ id: true, assignedAt: true });
export type InsertCoachAssignment = z.infer<typeof insertCoachAssignmentSchema>;
export type CoachAssignment = typeof coachAssignments.$inferSelect;

// Audit log table
export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  actorId: varchar("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  at: timestamp("at").notNull().defaultNow(),
}, (table) => ({
  actorIdIdx: index("audit_log_actor_id_idx").on(table.actorId),
  entityIdx: index("audit_log_entity_idx").on(table.entity, table.entityId),
}));

export const insertAuditLogSchema = createInsertSchema(auditLog).omit({ id: true, at: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLog.$inferSelect;

// ============================================================================
// COURSE ROADMAP TABLES (Migration 007)
// ============================================================================

// Weekly Metrics table (study hours tracking)
export const weeklyMetrics = pgTable("weekly_metrics", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekOf: date("week_of").notNull(), // Monday of the week
  hoursStudied: integer("hours_studied").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userWeekIdx: uniqueIndex("idx_weekly_metrics_user_week").on(table.userId, table.weekOf),
  weekOfIdx: index("idx_weekly_metrics_week_of").on(table.weekOf),
}));

export const insertWeeklyMetricSchema = createInsertSchema(weeklyMetrics).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWeeklyMetric = z.infer<typeof insertWeeklyMetricSchema>;
export type WeeklyMetric = typeof weeklyMetrics.$inferSelect;

// Pricing Rules table
export const pricingRules = pgTable("pricing_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  provider: text("provider").notNull(),
  school: text("school"),
  model: pricingModelEnum("model").notNull(),
  monthlyPrice: integer("monthly_price"), // in cents
  perSessionPrice: integer("per_session_price"), // in cents (also used for per-course pricing)
  perCreditPrice: integer("per_credit_price"), // in cents (for per-credit pricing models)
  coursesPerMonth: integer("courses_per_month"),
  fee: integer("fee").default(0),
  startsOn: date("starts_on"),
  endsOn: date("ends_on"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  providerIdx: index("idx_pricing_rules_provider").on(table.provider),
  activeIdx: index("idx_pricing_rules_active").on(table.provider, table.school),
}));

export const insertPricingRuleSchema = createInsertSchema(pricingRules).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPricingRule = z.infer<typeof insertPricingRuleSchema>;
export type PricingRule = typeof pricingRules.$inferSelect;

// Weekly Snapshots table (trend tracking)
export const snapshotsWeekly = pgTable("snapshots_weekly", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  weekOf: date("week_of").notNull(),
  projectedTotal: integer("projected_total").notNull(), // in cents
  etaMonths: integer("eta_months").notNull(),
  paceHours: integer("pace_hours").notNull(),
  creditsCompleted: integer("credits_completed").notNull().default(0),
  creditsInProgress: integer("credits_in_progress").notNull().default(0),
  creditsRemaining: integer("credits_remaining").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userWeekIdx: uniqueIndex("idx_snapshots_user_week").on(table.userId, table.weekOf),
  weekOfIdx: index("idx_snapshots_week_of").on(table.weekOf),
}));

export const insertSnapshotWeeklySchema = createInsertSchema(snapshotsWeekly).omit({ id: true, createdAt: true });
export type InsertSnapshotWeekly = z.infer<typeof insertSnapshotWeeklySchema>;
export type SnapshotWeekly = typeof snapshotsWeekly.$inferSelect;

// ============================================================================
// Student Profile Schemas (defined in SQL migration 005)
// ============================================================================

// Enums matching SQL migration 005
export const studentStatusEnum = z.enum(['lead', 'active', 'paused', 'graduated']);
export const residencyEnum = z.enum(['us', 'foreign']);
export const hsPathEnum = z.enum(['local_diploma', 'ged', 'foreign']);
export const targetPaceEnum = z.enum(['fast', 'standard', 'extended']);
export const contactTypeEnum = z.enum(['parent', 'spouse', 'guardian', 'other']);
export const docTypeEnum = z.enum([
  'id_gov',
  'hs_diploma',
  'hs_transcript',
  'degree_certificate',
  'college_transcript',
  'foreign_eval',
  'english_cert',
  'residency_doc',
  'consent_form',
  'other'
]);
export const docStatusEnum = z.enum(['pending', 'verified', 'rejected', 'resubmit_requested']);
export const visibilityEnum = z.enum(['student_staff', 'staff_only', 'public']);
export const englishProofTypeEnum = z.enum(['duolingo', 'ielts', 'toefl', 'cambridge', 'lumiere_placement']);

// Student schema
export const studentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  student_code: z.string(),
  status: studentStatusEnum,
  
  // Identity
  first_name: z.string().min(1).max(80),
  middle_name: z.string().max(80).nullable(),
  last_name: z.string().min(1).max(80),
  preferred_name: z.string().max(80).nullable(),
  dob: z.string(), // ISO date string
  sex: z.string().nullable(),
  nationality: z.array(z.string()).default([]),
  gov_id_type: z.string().nullable(),
  gov_id_number: z.string().nullable(),
  photo_url: z.string().nullable(),
  
  // Residency & Eligibility
  residency: residencyEnum,
  hs_completion: z.boolean(),
  hs_path: hsPathEnum.nullable(),
  hs_country: z.string().nullable(),
  hs_school: z.string().nullable(),
  hs_year: z.number().int().nullable(),
  hs_doc_url: z.string().nullable(),
  
  // Contact
  email: z.string().email(),
  email_verified_at: z.string().nullable(), // ISO datetime
  phone_primary: z.string(),
  phone_secondary: z.string().nullable(),
  whatsapp_primary: z.boolean().default(false),
  timezone: z.string().nullable(),
  preferred_contact_channel: z.string().default('email'),
  
  // Address
  address_country: z.string(),
  address_state: z.string().nullable(),
  address_city: z.string().nullable(),
  address_postal: z.string().nullable(),
  address_line1: z.string(),
  address_line2: z.string().nullable(),
  
  // Program Intent
  target_degree: z.string().nullable(),
  target_major: z.string().nullable(),
  start_term: z.string().nullable(), // ISO date
  prior_credits: z.boolean().default(false),
  prior_credits_est: z.number().int().nullable(),
  prior_sources: z.array(z.string()).default([]),
  transcripts_url: z.array(z.string()).default([]),
  target_pace: targetPaceEnum.nullable(),
  
  // Compliance
  marketing_opt_in: z.boolean().default(false),
  media_release: z.boolean().default(false),
  consent_signed_at: z.string().nullable(),
  consent_signature: z.string().nullable(),
  
  // Metadata
  created_at: z.string(),
  updated_at: z.string(),
});

export const insertStudentSchema = studentSchema.omit({
  id: true,
  student_code: true,
  created_at: true,
  updated_at: true,
  email_verified_at: true,
  consent_signed_at: true,
});

export type Student = z.infer<typeof studentSchema>;
export type InsertStudent = z.infer<typeof insertStudentSchema>;

// English proof schema
export const englishProofSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  proof_type: englishProofTypeEnum,
  score: z.number(),
  test_date: z.string(), // ISO date
  issuer: z.string().nullable(),
  test_id: z.string().nullable(),
  meets_requirement: z.boolean(),
  doc_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const insertEnglishProofSchema = englishProofSchema.omit({
  id: true,
  meets_requirement: true,
  created_at: true,
  updated_at: true,
});

export type EnglishProof = z.infer<typeof englishProofSchema>;
export type InsertEnglishProof = z.infer<typeof insertEnglishProofSchema>;

// Student contact schema
export const studentContactSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  type: contactTypeEnum,
  full_name: z.string().min(1),
  relationship: z.string().min(1),
  phone: z.string(),
  email: z.string().email().nullable(),
  language: z.string().nullable(),
  scopes: z.array(z.enum(['academic', 'financial', 'emergency', 'release'])).default([]),
  consent_doc_url: z.string().nullable(),
  created_at: z.string(),
});

export const insertStudentContactSchema = studentContactSchema.omit({
  id: true,
  created_at: true,
});

export type StudentContact = z.infer<typeof studentContactSchema>;
export type InsertStudentContact = z.infer<typeof insertStudentContactSchema>;

// Student document schema
export const studentDocumentSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid(),
  
  // Metadata
  doc_type: docTypeEnum,
  file_name: z.string(),
  issuer: z.string().nullable(),
  doc_date: z.string().nullable(), // ISO date
  score: z.string().nullable(),
  country: z.string().nullable(),
  notes: z.string().nullable(),
  
  // Storage
  url: z.string(),
  storage_path: z.string(),
  visibility: visibilityEnum,
  required_for_enrollment: z.boolean().default(false),
  
  // Verification
  status: docStatusEnum,
  verified: z.boolean().default(false),
  verified_by: z.string().uuid().nullable(),
  verified_at: z.string().nullable(),
  admin_notes: z.string().nullable(),
  
  // OCR
  ocr_text: z.string().nullable(),
  
  // Soft delete
  soft_deleted: z.boolean().default(false),
  
  // Timestamps
  uploaded_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const insertStudentDocumentSchema = studentDocumentSchema.omit({
  id: true,
  verified: true,
  verified_by: true,
  verified_at: true,
  uploaded_at: true,
  created_at: true,
  updated_at: true,
});

export type StudentDocument = z.infer<typeof studentDocumentSchema>;
export type InsertStudentDocument = z.infer<typeof insertStudentDocumentSchema>;

// Audit log schema (student profile specific)
export const studentAuditLogSchema = z.object({
  id: z.string().uuid(),
  student_id: z.string().uuid().nullable(),
  actor_id: z.string().uuid().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().uuid().nullable(),
  field: z.string().nullable(),
  old_value: z.any().nullable(),
  new_value: z.any().nullable(),
  metadata: z.any().nullable(),
  created_at: z.string(),
});

export const insertStudentAuditLogSchema = studentAuditLogSchema.omit({
  id: true,
  created_at: true,
});

export type StudentAuditLog = z.infer<typeof studentAuditLogSchema>;
export type InsertStudentAuditLog = z.infer<typeof insertStudentAuditLogSchema>;
