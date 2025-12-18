import { pgTable, text, integer, uuid, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============= TABLES =============

// USERS / STUDENTS
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// DEGREE TEMPLATES
export const degreeTemplates = pgTable("degree_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  university: text("university").notNull(),
  degreeName: text("degree_name").notNull(),
  totalCredits: integer("total_credits").notNull(),
  minUpperCredits: integer("min_upper_credits").notNull().default(0),
  residencyCredits: integer("residency_credits").notNull().default(0),
  capstoneCode: text("capstone_code"),
  lastUpdated: timestamp("last_updated", { withTimezone: true }).notNull().defaultNow(),
});

// DEGREE REQUIREMENTS
export const degreeRequirements = pgTable("degree_requirements", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateId: uuid("template_id").notNull().references(() => degreeTemplates.id, { onDelete: "cascade" }),
  areaCode: text("area_code").notNull(),
  areaName: text("area_name").notNull(),
  requiredCredits: integer("required_credits").notNull(),
  mustTakeCourseCodes: text("must_take_course_codes").array().default([]),
  notes: text("notes").default(""),
});

// REQUIREMENT MAPPINGS
export const requirementMappings = pgTable("requirement_mappings", {
  id: uuid("id").primaryKey().defaultRandom(),
  requirementId: uuid("requirement_id").notNull().references(() => degreeRequirements.id, { onDelete: "cascade" }),
  courseCodePattern: text("course_code_pattern"),
  titleKeywords: text("title_keywords").array().default([]),
  fulfillsCredits: integer("fulfills_credits").notNull().default(3),
  level: text("level"), // 'lower' | 'upper' | null
  providerFilter: text("provider_filter").array().default([]),
  notes: text("notes").default(""),
});

// PROVIDER CATALOG
export const providerCatalog = pgTable("provider_catalog", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  courseCode: text("course_code").notNull(),
  title: text("title").notNull(),
  credits: integer("credits").notNull(),
  level: text("level"), // 'lower' | 'upper' | null
  estHours: integer("est_hours").default(45),
  url: text("url"),
  priceEst: numeric("price_est", { precision: 10, scale: 2 }).default("0"),
  areaTags: text("area_tags").array().default([]),
});

// ROADMAP PLANS (each student's degree plan)
export const roadmapPlans = pgTable("roadmap_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  templateId: uuid("template_id").notNull().references(() => degreeTemplates.id, { onDelete: "cascade" }),
  status: text("status").default("draft"),
  totalRemainingCredits: integer("total_remaining_credits").default(0),
  estCost: numeric("est_cost", { precision: 10, scale: 2 }).default("0"),
  estMonths: integer("est_months").default(0),
  version: integer("version").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ROADMAP STEPS (individual course steps)
export const roadmapSteps = pgTable("roadmap_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  planId: uuid("plan_id").notNull().references(() => roadmapPlans.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index"),
  itemType: text("item_type"), // 'provider_course' | 'university_session'
  refCode: text("ref_code"),
  title: text("title"),
  credits: integer("credits"),
  estCost: numeric("est_cost", { precision: 10, scale: 2 }),
  estWeeks: integer("est_weeks"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============= INSERT SCHEMAS =============

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertDegreeTemplateSchema = createInsertSchema(degreeTemplates).omit({ id: true, lastUpdated: true });
export const insertDegreeRequirementSchema = createInsertSchema(degreeRequirements).omit({ id: true });
export const insertRequirementMappingSchema = createInsertSchema(requirementMappings).omit({ id: true });
export const insertProviderCatalogSchema = createInsertSchema(providerCatalog).omit({ id: true });
export const insertRoadmapPlanSchema = createInsertSchema(roadmapPlans).omit({ id: true, createdAt: true });
export const insertRoadmapStepSchema = createInsertSchema(roadmapSteps).omit({ id: true, createdAt: true });

// ============= SELECT TYPES =============

export type User = typeof users.$inferSelect;
export type DegreeTemplate = typeof degreeTemplates.$inferSelect;
export type DegreeRequirement = typeof degreeRequirements.$inferSelect;
export type RequirementMapping = typeof requirementMappings.$inferSelect;
export type ProviderCatalog = typeof providerCatalog.$inferSelect;
export type RoadmapPlan = typeof roadmapPlans.$inferSelect;
export type RoadmapStep = typeof roadmapSteps.$inferSelect;

// ============= INSERT TYPES =============

export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertDegreeTemplate = z.infer<typeof insertDegreeTemplateSchema>;
export type InsertDegreeRequirement = z.infer<typeof insertDegreeRequirementSchema>;
export type InsertRequirementMapping = z.infer<typeof insertRequirementMappingSchema>;
export type InsertProviderCatalog = z.infer<typeof insertProviderCatalogSchema>;
export type InsertRoadmapPlan = z.infer<typeof insertRoadmapPlanSchema>;
export type InsertRoadmapStep = z.infer<typeof insertRoadmapStepSchema>;
