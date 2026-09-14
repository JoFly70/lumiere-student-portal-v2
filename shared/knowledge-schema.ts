/**
 * Lumière Knowledge Core — Canonical Knowledge Schema
 *
 * Phase 1A: Database + type-safe schema foundation only.
 *
 * Conceptual model:
 *   EVIDENCE → CLAIM → VERIFICATION → CANONICAL KNOWLEDGE
 *
 * All tables are ADDITIVE to the existing legacy academic schema.
 * No existing tables are modified, renamed, or deleted.
 */

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  varchar,
  uuid,
  integer,
  timestamp,
  boolean,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  date,
  primaryKey,
  bigserial,
} from "drizzle-orm/pg-core";

// ── Enums ────────────────────────────────────────────────────────────────────

export const knowledgeStatusEnum = pgEnum("knowledge_status", [
  "working",
  "open",
  "confirmed",
  "conflict",
  "incorrect",
  "superseded",
]);

export const versionStatusEnum = pgEnum("version_status", [
  "working",
  "open",
  "confirmed",
  "conflict",
  "incorrect",
  "superseded",
]);

export const claimStatusEnum = pgEnum("claim_status", [
  "working",
  "open",
  "confirmed",
  "conflict",
  "incorrect",
  "superseded",
]);

export const sourceTypeEnum = pgEnum("source_type", [
  "official_web",
  "official_catalog",
  "official_pdf",
  "advisor_email",
  "advisor_statement",
  "institutional_document",
  "provider_document",
  "internal_research",
  "third_party",
  "community",
  "other",
]);

export const authorityLevelEnum = pgEnum("authority_level", [
  "primary",
  "official_advisor",
  "institutional",
  "provider",
  "third_party",
  "community",
  "unknown",
]);

export const claimTypeEnum = pgEnum("claim_type", [
  "equivalency",
  "requirement",
  "rule",
  "course_attribute",
  "program_attribute",
  "institution_attribute",
  "other",
]);

export const subjectTypeEnum = pgEnum("subject_type", [
  "institution",
  "program",
  "program_version",
  "requirement",
  "institution_course",
  "provider_course",
  "provider",
  "other",
]);

export const verificationActionEnum = pgEnum("verification_action", [
  "submitted",
  "verified",
  "rejected",
  "needs_review",
  "superseded",
]);

export const conflictStatusEnum = pgEnum("conflict_status", [
  "open",
  "resolved",
  "ignored",
]);

export const conflictTypeEnum = pgEnum("conflict_type", [
  "contradiction",
  "temporal",
  "source_conflict",
  "interpretation",
  "other",
]);

export const ruleKindEnum = pgEnum("rule_kind", [
  "general",
  "transfer",
  "residency",
  "upper_level",
  "admission",
  "graduation",
  "course",
  "other",
]);

export const institutionVersionStatusEnum = pgEnum("institution_version_status", [
  "active",
  "retired",
  "draft",
]);

export const programVersionStatusEnum = pgEnum("program_version_status", [
  "active",
  "retired",
  "draft",
]);

export const evidenceRelationshipTypeEnum = pgEnum("evidence_relationship_type", [
  "supports",
  "contradicts",
  "contextual",
  "source_for",
]);

// ── Reusable status constants ───────────────────────────────────────────────

export const KNOWLEDGE_STATUSES = [
  "working",
  "open",
  "confirmed",
  "conflict",
  "incorrect",
  "superseded",
] as const;

export const VERIFICATION_ACTIONS = [
  "submitted",
  "verified",
  "rejected",
  "needs_review",
  "superseded",
] as const;

export const RULE_KINDS = [
  "general",
  "transfer",
  "residency",
  "upper_level",
  "admission",
  "graduation",
  "course",
  "other",
] as const;

export const SOURCE_TYPES = [
  "official_web",
  "official_catalog",
  "official_pdf",
  "advisor_email",
  "advisor_statement",
  "institutional_document",
  "provider_document",
  "internal_research",
  "third_party",
  "community",
  "other",
] as const;

export const AUTHORITY_LEVELS = [
  "primary",
  "official_advisor",
  "institutional",
  "provider",
  "third_party",
  "community",
  "unknown",
] as const;

// ── 1. Institutions ──────────────────────────────────────────────────────────

export const institutions = pgTable("knowledge_institutions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex("knowledge_institutions_slug_idx").on(table.slug),
}));

export const institutionVersions = pgTable("knowledge_institution_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  versionLabel: text("version_label").notNull(),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  status: institutionVersionStatusEnum("status").notNull().default("active"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  institutionIdx: index("knowledge_inst_versions_inst_idx").on(table.institutionId),
}));

// ── 2. Programs ─────────────────────────────────────────────────────────────

export const programsV2 = pgTable("knowledge_programs_v2", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  degreeLevel: text("degree_level"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  institutionIdx: index("knowledge_programs_v2_inst_idx").on(table.institutionId),
  instCodeIdx: uniqueIndex("knowledge_programs_v2_inst_code_idx").on(table.institutionId, table.code),
}));

export const programVersions = pgTable("knowledge_program_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  programId: uuid("program_id").notNull().references(() => programsV2.id, { onDelete: "cascade" }),
  versionLabel: text("version_label").notNull(),
  catalogYear: integer("catalog_year"),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  status: programVersionStatusEnum("status").notNull().default("active"),
  totalCreditsRequired: integer("total_credits_required"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  programIdx: index("knowledge_prog_versions_prog_idx").on(table.programId),
}));

// ── 3. Requirements ─────────────────────────────────────────────────────────

export const requirementGroups = pgTable("knowledge_requirement_groups", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  programVersionId: uuid("program_version_id").notNull().references(() => programVersions.id, { onDelete: "cascade" }),
  parentGroupId: uuid("parent_group_id").references((): any => requirementGroups.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  title: text("title").notNull(),
  sequence: integer("sequence").notNull().default(0),
  minCredits: integer("min_credits"),
  maxCredits: integer("max_credits"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  programVersionIdx: index("knowledge_req_groups_pv_idx").on(table.programVersionId),
  parentGroupIdx: index("knowledge_req_groups_parent_idx").on(table.parentGroupId),
}));

export const requirementsV2 = pgTable("knowledge_requirements_v2", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  programVersionId: uuid("program_version_id").notNull().references(() => programVersions.id, { onDelete: "cascade" }),
  requirementGroupId: uuid("requirement_group_id").references(() => requirementGroups.id, { onDelete: "set null" }),
  code: text("code").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  creditsRequired: integer("credits_required"),
  levelRequirement: text("level_requirement"),
  sequence: integer("sequence").notNull().default(0),
  ruleExpression: jsonb("rule_expression"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  programVersionIdx: index("knowledge_req_v2_pv_idx").on(table.programVersionId),
  groupIdx: index("knowledge_req_v2_group_idx").on(table.requirementGroupId),
}));

// ── 4. Institution Courses ───────────────────────────────────────────────────

export const institutionCourses = pgTable("knowledge_institution_courses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  courseCode: text("course_code").notNull(),
  title: text("title").notNull(),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  institutionIdx: index("knowledge_inst_courses_inst_idx").on(table.institutionId),
  instCodeIdx: uniqueIndex("knowledge_inst_courses_inst_code_idx").on(table.institutionId, table.courseCode),
}));

export const institutionCourseVersions = pgTable("knowledge_institution_course_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  institutionCourseId: uuid("institution_course_id").notNull().references(() => institutionCourses.id, { onDelete: "cascade" }),
  versionLabel: text("version_label").notNull(),
  credits: integer("credits").notNull(),
  level: text("level"),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  courseIdx: index("knowledge_inst_course_ver_course_idx").on(table.institutionCourseId),
}));

// ── 5. Credit Providers ─────────────────────────────────────────────────────

export const creditProviders = pgTable("knowledge_credit_providers", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  providerType: text("provider_type"),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex("knowledge_credit_providers_slug_idx").on(table.slug),
}));

export const providerCourses = pgTable("knowledge_provider_courses", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  providerId: uuid("provider_id").notNull().references(() => creditProviders.id, { onDelete: "cascade" }),
  courseCode: text("course_code").notNull(),
  title: text("title").notNull(),
  active: boolean("active").notNull().default(true),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  providerIdx: index("knowledge_provider_courses_prov_idx").on(table.providerId),
  provCodeIdx: uniqueIndex("knowledge_provider_courses_prov_code_idx").on(table.providerId, table.courseCode),
}));

export const providerCourseVersions = pgTable("knowledge_provider_course_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  providerCourseId: uuid("provider_course_id").notNull().references(() => providerCourses.id, { onDelete: "cascade" }),
  versionLabel: text("version_label").notNull(),
  credits: integer("credits").notNull(),
  creditType: text("credit_type"),
  level: text("level"),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  courseIdx: index("knowledge_provider_course_ver_course_idx").on(table.providerCourseId),
}));

// ── 6. Evidence ──────────────────────────────────────────────────────────────

export const evidenceSources = pgTable("knowledge_evidence_sources", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceType: sourceTypeEnum("source_type").notNull(),
  institutionId: uuid("institution_id").references(() => institutions.id, { onDelete: "set null" }),
  providerId: uuid("provider_id").references(() => creditProviders.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  externalFileId: text("external_file_id"),
  contentHash: text("content_hash"),
  authorityLevel: authorityLevelEnum("authority_level").notNull().default("unknown"),
  publishedAt: timestamp("published_at"),
  retrievedAt: timestamp("retrieved_at").notNull().defaultNow(),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Actor reference — text because users.id is text in the Lumière schema
  createdBy: text("created_by"),
}, (table) => ({
  sourceTypeIdx: index("knowledge_evidence_sources_type_idx").on(table.sourceType),
  institutionIdx: index("knowledge_evidence_sources_inst_idx").on(table.institutionId),
  providerIdx: index("knowledge_evidence_sources_prov_idx").on(table.providerId),
}));

export const evidenceExcerpts = pgTable("knowledge_evidence_excerpts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  evidenceSourceId: uuid("evidence_source_id").notNull().references(() => evidenceSources.id, { onDelete: "restrict" }),
  excerptText: text("excerpt_text").notNull(),
  locator: text("locator"),
  pageNumber: integer("page_number"),
  section: text("section"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  sourceIdx: index("knowledge_evidence_excerpts_source_idx").on(table.evidenceSourceId),
}));

// ── 7. Claims ─────────────────────────────────────────────────────────────────

export const knowledgeClaims = pgTable("knowledge_claims", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  claimKey: text("claim_key").notNull().unique(),
  claimType: claimTypeEnum("claim_type").notNull(),
  subjectType: subjectTypeEnum("subject_type").notNull(),
  // Polymorphic reference — stays text because it can reference different tables
  subjectId: text("subject_id"),
  // Provenance FK → knowledge_claim_versions.id (circular, added via ALTER in migration)
  currentVersionId: uuid("current_version_id").references(() => claimVersions.id, { onDelete: "set null" }),
  status: claimStatusEnum("status").notNull().default("working"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Actor reference — text
  createdBy: text("created_by"),
}, (table) => ({
  claimKeyIdx: uniqueIndex("knowledge_claims_key_idx").on(table.claimKey),
  subjectIdx: index("knowledge_claims_subject_idx").on(table.subjectType, table.subjectId),
  statusIdx: index("knowledge_claims_status_idx").on(table.status),
}));

export const claimVersions = pgTable("knowledge_claim_versions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  claimId: uuid("claim_id").notNull().references(() => knowledgeClaims.id, { onDelete: "restrict" }),
  versionNumber: integer("version_number").notNull(),
  statement: text("statement").notNull(),
  normalizedValue: jsonb("normalized_value"),
  confidence: integer("confidence").notNull().default(50),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  catalogApplicability: text("catalog_applicability"),
  cohortApplicability: text("cohort_applicability"),
  status: versionStatusEnum("status").notNull().default("working"),
  // Provenance FK → self-reference (supersedes prior version)
  supersedesVersionId: uuid("supersedes_version_id").references((): any => claimVersions.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Actor reference — text
  createdBy: text("created_by"),
}, (table) => ({
  claimIdx: index("knowledge_claim_versions_claim_idx").on(table.claimId),
  claimVersionUnique: uniqueIndex("knowledge_claim_versions_unique_idx").on(table.claimId, table.versionNumber),
  statusIdx: index("knowledge_claim_versions_status_idx").on(table.status),
}));

export const claimEvidence = pgTable("knowledge_claim_evidence", {
  claimVersionId: uuid("claim_version_id").notNull().references(() => claimVersions.id, { onDelete: "restrict" }),
  evidenceExcerptId: uuid("evidence_excerpt_id").notNull().references(() => evidenceExcerpts.id, { onDelete: "restrict" }),
  relationshipType: evidenceRelationshipTypeEnum("relationship_type").notNull().default("supports"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.claimVersionId, table.evidenceExcerptId] }),
  evidenceIdx: index("knowledge_claim_evidence_excerpt_idx").on(table.evidenceExcerptId),
}));

// ── 8. Verification ──────────────────────────────────────────────────────────

export const verificationEvents = pgTable("knowledge_verification_events", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  claimVersionId: uuid("claim_version_id").notNull().references(() => claimVersions.id, { onDelete: "restrict" }),
  action: verificationActionEnum("action").notNull(),
  // Actor reference — text
  reviewerId: text("reviewer_id"),
  rationale: text("rationale"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  seq: bigserial("seq", { mode: "number" }).notNull(),
}, (table) => ({
  claimVersionIdx: index("knowledge_verif_events_cv_idx").on(table.claimVersionId),
  actionIdx: index("knowledge_verif_events_action_idx").on(table.action),
  cvSeqIdx: index("knowledge_verif_events_cv_seq_idx").on(table.claimVersionId, table.seq),
}));

// ── 9. Conflicts ─────────────────────────────────────────────────────────────

export const knowledgeConflicts = pgTable("knowledge_conflicts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  claimVersionAId: uuid("claim_version_a_id").notNull().references(() => claimVersions.id, { onDelete: "restrict" }),
  claimVersionBId: uuid("claim_version_b_id").references(() => claimVersions.id, { onDelete: "restrict" }),
  conflictType: conflictTypeEnum("conflict_type").notNull(),
  description: text("description").notNull(),
  status: conflictStatusEnum("status").notNull().default("open"),
  resolutionNotes: text("resolution_notes"),
  // Actor reference — text
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  versionAIdx: index("knowledge_conflicts_a_idx").on(table.claimVersionAId),
  versionBIdx: index("knowledge_conflicts_b_idx").on(table.claimVersionBId),
  statusIdx: index("knowledge_conflicts_status_idx").on(table.status),
}));

// ── 11. Canonical Academic Rules ─────────────────────────────────────────────

export const academicRules = pgTable("knowledge_academic_rules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  programVersionId: uuid("program_version_id").references(() => programVersions.id, { onDelete: "set null" }),
  ruleKey: text("rule_key").notNull(),
  ruleKind: ruleKindEnum("rule_kind").notNull(),
  title: text("title").notNull(),
  ruleValue: jsonb("rule_value").notNull().default(sql`'{}'::jsonb`),
  // Provenance FK → knowledge_claim_versions.id
  claimVersionId: uuid("claim_version_id").references(() => claimVersions.id, { onDelete: "restrict" }),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  status: knowledgeStatusEnum("status").notNull().default("working"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  institutionIdx: index("knowledge_academic_rules_inst_idx").on(table.institutionId),
  programVersionIdx: index("knowledge_academic_rules_pv_idx").on(table.programVersionId),
  ruleKindIdx: index("knowledge_academic_rules_kind_idx").on(table.ruleKind),
  statusIdx: index("knowledge_academic_rules_status_idx").on(table.status),
}));

export const transferRules = pgTable("knowledge_transfer_rules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  academicRuleId: uuid("academic_rule_id").notNull().references(() => academicRules.id, { onDelete: "cascade" }),
  maxTransferCredits: integer("max_transfer_credits"),
  maxLowerLevelTransfer: integer("max_lower_level_transfer"),
  maxUpperLevelTransfer: integer("max_upper_level_transfer"),
  providerRestrictions: jsonb("provider_restrictions").notNull().default(sql`'{}'::jsonb`),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
}, (table) => ({
  ruleIdx: index("knowledge_transfer_rules_rule_idx").on(table.academicRuleId),
}));

export const residencyRules = pgTable("knowledge_residency_rules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  academicRuleId: uuid("academic_rule_id").notNull().references(() => academicRules.id, { onDelete: "cascade" }),
  minResidencyCredits: integer("min_residency_credits"),
  residencyType: text("residency_type"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
}, (table) => ({
  ruleIdx: index("knowledge_residency_rules_rule_idx").on(table.academicRuleId),
}));

export const upperLevelRules = pgTable("knowledge_upper_level_rules", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  academicRuleId: uuid("academic_rule_id").notNull().references(() => academicRules.id, { onDelete: "cascade" }),
  minUpperLevelCredits: integer("min_upper_level_credits"),
  levelThreshold: text("level_threshold"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
}, (table) => ({
  ruleIdx: index("knowledge_upper_level_rules_rule_idx").on(table.academicRuleId),
}));

// ── 12. Equivalencies ────────────────────────────────────────────────────────

export const equivalenciesV2 = pgTable("knowledge_equivalencies_v2", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  sourceProviderCourseVersionId: uuid("source_provider_course_version_id").notNull().references(() => providerCourseVersions.id, { onDelete: "cascade" }),
  targetInstitutionCourseVersionId: uuid("target_institution_course_version_id").references(() => institutionCourseVersions.id, { onDelete: "set null" }),
  institutionId: uuid("institution_id").notNull().references(() => institutions.id, { onDelete: "cascade" }),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  status: knowledgeStatusEnum("status").notNull().default("working"),
  confidence: integer("confidence").notNull().default(50),
  // Provenance FK → knowledge_claim_versions.id
  claimVersionId: uuid("claim_version_id").references(() => claimVersions.id, { onDelete: "restrict" }),
  notes: text("notes"),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  sourceIdx: index("knowledge_equiv_v2_source_idx").on(table.sourceProviderCourseVersionId),
  targetIdx: index("knowledge_equiv_v2_target_idx").on(table.targetInstitutionCourseVersionId),
  institutionIdx: index("knowledge_equiv_v2_inst_idx").on(table.institutionId),
  statusIdx: index("knowledge_equiv_v2_status_idx").on(table.status),
}));

// ── 13. Articulations ────────────────────────────────────────────────────────

export const articulationsV2 = pgTable("knowledge_articulations_v2", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  programVersionId: uuid("program_version_id").notNull().references(() => programVersions.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id").notNull().references(() => requirementsV2.id, { onDelete: "cascade" }),
  institutionCourseVersionId: uuid("institution_course_version_id").references(() => institutionCourseVersions.id, { onDelete: "set null" }),
  equivalencyId: uuid("equivalency_id").references(() => equivalenciesV2.id, { onDelete: "set null" }),
  creditsApplied: integer("credits_applied"),
  priority: integer("priority").notNull().default(0),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  status: knowledgeStatusEnum("status").notNull().default("working"),
  // Provenance FK → knowledge_claim_versions.id
  claimVersionId: uuid("claim_version_id").references(() => claimVersions.id, { onDelete: "restrict" }),
  metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  programVersionIdx: index("knowledge_artic_v2_pv_idx").on(table.programVersionId),
  requirementIdx: index("knowledge_artic_v2_req_idx").on(table.requirementId),
  courseVersionIdx: index("knowledge_artic_v2_course_idx").on(table.institutionCourseVersionId),
  equivalencyIdx: index("knowledge_artic_v2_equiv_idx").on(table.equivalencyId),
  statusIdx: index("knowledge_artic_v2_status_idx").on(table.status),
}));

// ── Type exports ─────────────────────────────────────────────────────────────

export type Institution = typeof institutions.$inferSelect;
export type InstitutionVersion = typeof institutionVersions.$inferSelect;
export type ProgramV2 = typeof programsV2.$inferSelect;
export type ProgramVersion = typeof programVersions.$inferSelect;
export type RequirementGroup = typeof requirementGroups.$inferSelect;
export type RequirementV2 = typeof requirementsV2.$inferSelect;
export type InstitutionCourse = typeof institutionCourses.$inferSelect;
export type InstitutionCourseVersion = typeof institutionCourseVersions.$inferSelect;
export type CreditProvider = typeof creditProviders.$inferSelect;
export type ProviderCourse = typeof providerCourses.$inferSelect;
export type ProviderCourseVersion = typeof providerCourseVersions.$inferSelect;
export type EvidenceSource = typeof evidenceSources.$inferSelect;
export type EvidenceExcerpt = typeof evidenceExcerpts.$inferSelect;
export type KnowledgeClaim = typeof knowledgeClaims.$inferSelect;
export type ClaimVersion = typeof claimVersions.$inferSelect;
export type ClaimEvidence = typeof claimEvidence.$inferSelect;
export type VerificationEvent = typeof verificationEvents.$inferSelect;
export type KnowledgeConflict = typeof knowledgeConflicts.$inferSelect;
export type AcademicRule = typeof academicRules.$inferSelect;
export type TransferRule = typeof transferRules.$inferSelect;
export type ResidencyRule = typeof residencyRules.$inferSelect;
export type UpperLevelRule = typeof upperLevelRules.$inferSelect;
export type EquivalencyV2 = typeof equivalenciesV2.$inferSelect;
export type ArticulationV2 = typeof articulationsV2.$inferSelect;
