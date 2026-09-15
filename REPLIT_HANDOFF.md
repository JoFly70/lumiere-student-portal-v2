# LUMIÈRE OS — REPLIT HANDOFF

> **Authoritative for project identity.** Read this before making changes.
> Historical documentation may contain obsolete project references;
> REPLIT_HANDOFF.md + current code/tests are authoritative.

---

## A. PRODUCT

**Lumière OS / Lumière Higher-Ed Pathways**

Core flow:

```
university evidence → Lumière Knowledge Core → structured student academic records → deterministic degree audit → pathway optimization → advisor/student workflows → AI/research automation
```

Principles: **Simple, Repeatable, Efficient, Scalable.**

AI is NOT source of truth. Canonical truth model:

```
EVIDENCE → CLAIM → VERIFICATION → CANONICAL RULE
```

---

## B. CURRENT STACK

- React 18, Wouter (client routing)
- Tailwind CSS, shadcn/ui (Radix primitives)
- TanStack Query (server state)
- Express.js / Node.js (API)
- Drizzle ORM (type-safe DB)
- Supabase Auth (email/password, sessions)
- Supabase / PostgreSQL (database)
- Supabase Storage (file uploads)
- Stripe (payments/billing)
- Redis (rate limiting, in-memory fallback)
- Helmet (security headers)
- Sentry integration hooks (optional; SDK packages are not installed by default)
- Zod (validation)
- Recharts (charts)
- Winston (logging)

Do not invent dependencies — verify against `package.json`.

---

## C. SOURCE-OF-TRUTH RULES

1. GitHub `main` is code source of truth.
2. `rheronevecsffaejteoj` is the canonical development database.
3. Never use `ypbzdbfqoflyszdsbivn`.
4. Never use `brrktoofhtcylxrundvl`.
5. Never infer canonical DB identity from stale historical docs.
6. Never run every old migration blindly.
7. Never mutate production/customer data to test.
8. Use disposable prefixed fixtures and failure-safe cleanup.
9. Human/controlled verification promotes Knowledge facts to canonical.
10. Deterministic engines make academic decisions; AI explains/assists.

---

## D. COMPLETED PHASES

All phases below are **CLOSED**. Phase 0–2 code/security closure SHA: `0368d3a332e4d2c1a41cfc66d0b7dad7ae709d46`. The Replit handoff documentation was added afterward on `main`; always import current GitHub `main` rather than a hardcoded handoff SHA.

### PHASE 0 — Stabilization / Auth / Security Baseline
- Staff role added to canonical role model
- Plan isolation and auth/RBAC baseline hardened
- Password recovery/update and admin-router protections stabilized
- Baseline check/test/build gates established

### PHASE 1 — Canonical Knowledge Core
- Knowledge institutions, programs, courses, providers, articulations
- Claim/evidence/verification model
- Versioned knowledge history (append-only)
- Verification event sequencing
- Staff read / admin mutation role matrix
- Internal staff/admin API + HTTP E2E

### PHASE 2 — Student Academic Record
- Student program assignments
- Academic sources
- Credit records
- Append-only verification events
- Append-only credit decisions
- Academic exceptions
- Internal staff/admin API + student self-read API
- Real Auth/RBAC/PostgreSQL E2E
- Real audit trail (SECURITY DEFINER, locked down)
- Security hardening (pre-Replit sweep + corrections)
- `current_user_role()` SECURITY DEFINER helper locked down with pinned search path
- Anon privileges removed from sensitive/canonical internal tables
- Ownership/RLS verification with real JWTs

---

## E. CANONICAL ACADEMIC ARCHITECTURE

**Canonical new architecture** = Knowledge Core tables + student academic record tables.

**Legacy overlapping academic models** (e.g. `degree_programs`, `courses`, `program_courses`, `student_program_enrollments` from the 2025-12 migration) still exist for existing portal functionality. They MUST NOT be mistaken for the canonical system or extended as the Phase 3 foundation.

Do not delete legacy tables during handoff.

---

## F. SECURITY INVARIANTS

- Server service-role Supabase client must never carry an end-user login session.
- End-user password auth uses isolated clients.
- Actor IDs derive from authenticated users, never request-body spoofing.
- Student academic ownership resolves from authenticated user.
- Append-only academic history — no authenticated DELETE paths for canonical academic history.
- Audit writes execute with service-role authority.
- Audit SECURITY DEFINER functions are locked down.
- Anon has no access to sensitive/canonical internal tables.
- Knowledge access: student denied, coach denied, staff read, admin mutation.
- Student record ownership is enforced.
- Document ownership resolves: `documents.student_id → students.id → students.user_id → authenticated user`.
- Legacy catalog mutation: admin + staff only; coach denied.

---

## G. CANONICAL MIGRATION STATE

Modern canonical migration chain (verify exact filenames in `supabase/migrations/`):

```
20260914182506_phase0_add_staff_role.sql
20260914195204_phase1a_knowledge_core_schema.sql
20260914200029_phase1a_knowledge_core_integrity_fix.sql
20260914200820_phase1a_knowledge_history_hardening.sql
20260914234000_phase1db_verification_event_sequence.sql
20260915160000_phase2a_student_academic_record.sql
20260915180000_phase2d_audit_logging.sql
20260915190000_phase2d_audit_security_hardening.sql
20260915200000_pre_replit_security_hardening.sql
20260915210000_policy_auth_users_remediation.sql
20260915220000_pre_replit_security_corrections.sql
```

**IMPORTANT:** Several late migrations were applied directly through canonical `DATABASE_URL` because the Supabase MCP pointed to the wrong project and the platform migration-history bookkeeping table was not writable through that path. The Supabase migration-history table may NOT be a complete representation of the actual live schema state.

- DO NOT reapply migrations solely because a migration-history table appears to omit them.
- Verify live schema/state first.
- Do not run a generic migration command against the existing canonical DB.

---

## H. ENVIRONMENT CONTRACT

Required variable NAMES (never store values in docs):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `SUPABASE_URL` | Server-side Supabase API URL |
| `SUPABASE_ANON_KEY` | Anon/publishable key |
| `SUPABASE_SERVICE_KEY` | Service-role secret key |
| `VITE_SUPABASE_URL` | Client-side Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | Client-side anon/publishable key |

Canonical identity requirements:

- `DATABASE_URL` must target `rheronevecsffaejteoj`
- `SUPABASE_URL` must equal `https://rheronevecsffaejteoj.supabase.co`
- `VITE_SUPABASE_URL` must equal `https://rheronevecsffaejteoj.supabase.co`
- Service key: modern `sb_secret_` prefix expected.
- Anon/publishable keys: modern `sb_publishable_` prefix expected.
- Replit must fail closed if project identity does not match.

Run `npm run verify:canonical-env` to check identity and key shapes (prints no secrets).

---

## I. KNOWN HISTORICAL / STALE DOCUMENTATION

Files containing noncanonical Supabase refs (`ypbzdbfqoflyszdsbivn` or `brrktoofhtcylxrundvl`) are historical/stale:

| File | Ref | Classification |
|---|---|---|
| `.env` | historical local drift | Gitignored and not imported from GitHub. Create fresh Replit secrets; during Bolt work local values had previously regressed to a noncanonical project. |
| `DEPLOYMENT_CHECKLIST.md` | `ypbzdbfqoflyszdsbivn` | Historical |
| `DEPLOYMENT_MASTER_GUIDE.md` | `ypbzdbfqoflyszdsbivn` | Historical |
| `DEPLOY_NETLIFY.md` | `ypbzdbfqoflyszdsbivn` | Historical |
| `DEPLOY_RENDER.md` | `ypbzdbfqoflyszdsbivn` | Historical |
| `ENVIRONMENT_VARIABLES.md` | `ypbzdbfqoflyszdsbivn` | Historical |
| `MANUAL_MIGRATION_REQUIRED.md` | `brrktoofhtcylxrundvl` | Historical |
| `MIGRATION_ATTEMPTS_SUMMARY.md` | `brrktoofhtcylxrundvl` | Historical |
| `QUICK_REFERENCE.md` | `ypbzdbfqoflyszdsbivn` | Historical |
| `complete-missing-tables.sql` | `brrktoofhtcylxrundvl` | Historical |
| `server/complete-missing-tables.ts` | `brrktoofhtcylxrundvl` | Historical |

`tests/phase1dc-http-e2e.test.ts` references `ypbzdbfqoflyszdsbivn` in an assertion that it is forbidden/noncanonical — do NOT alter this test.

Historical docs have been marked with a banner at the top to prevent confusion. Do not mass-delete historical files or rewrite old migration history.

---

## J. TEST / VALIDATION COMMANDS

### Standard gates

```bash
npm run check
npm test
npm run build
```

### Opt-in real E2E suites (require canonical environment variables; fail closed otherwise)

```bash
RUN_PHASE1DC_E2E=1 npx vitest run tests/phase1dc-http-e2e.test.ts --reporter=verbose

RUN_PHASE2D_E2E=1 npx vitest run tests/phase2d-student-academic-http-e2e.test.ts --reporter=verbose

RUN_P2D_SECURITY_E2E=1 npx vitest run tests/phase2d-security-hardening.test.ts --reporter=verbose

RUN_PRE_REPLIT_SECURITY_E2E=1 npx vitest run tests/pre-replit-security-e2e.test.ts --reporter=verbose
```

Real E2E tests require canonical environment variables and must fail closed against any other Supabase project.

---

## K. CURRENT VERIFIED TEST BASELINE

| Gate | Result |
|---|---|
| Standard tests | 472 passed / 0 failed |
| Phase 1DC E2E | 16/16 |
| Phase 2D E2E | 32/32 |
| Phase 2D security E2E | 17/17 |
| Pre-Replit security E2E | 42/42 |
| `npm run check` | PASS |
| `npm run build` | PASS |

---

## L. NEXT PHASE — PHASE 3

**PHASE 3 — DETERMINISTIC DEGREE AUDIT ENGINE**

Do NOT implement it yet.

Responsibility:

**INPUT:**
- verified student credit records
- latest accepted/rejected credit decisions
- active student program assignment
- canonical program version
- canonical requirements/rules
- academic exceptions

**OUTPUT per requirement:**

```
SATISFIED | PARTIAL | MISSING | CONFLICT | MANUAL_REVIEW
```

Audit must be **deterministic**. AI may explain the result but may not determine academic truth.

It must preserve **provenance** so every conclusion can trace back to:

```
student credit + program requirement/rule + decision/exception
```

Do not build the optimizer yet. Phase 4 remains Pathway Optimizer.

---

## M. LATER ROADMAP

- Phase 3: Deterministic Degree Audit Engine
- Phase 4: Pathway Optimizer
- Phase 5: Advisor/Admin Command Center
- Phase 6: Change Impact Engine
- Phase 7: Reconnect portal / Flight Deck / remove hardcodes
- Phase 8: AI/research automation

---

## N. REPLIT IMPORT PROCEDURE

1. Create a BRAND-NEW Replit app by importing the final GitHub `main`.
2. Do NOT merge with an older Lumière/MockPortal Repl.
3. Do NOT copy old Replit files into the new repo.
4. Configure secrets manually in Replit.
5. Never paste secrets into chat or commit them.
6. Verify canonical Supabase project identity BEFORE any DB mutation.
7. Run `npm run check`, `npm test`, `npm run build`.
8. Run appropriate real E2E gates.
9. Only after a clean baseline begin Phase 3.

Do not publish automatically.
