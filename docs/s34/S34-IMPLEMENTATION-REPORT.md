# S34 — Implementation report

- Branch: `claude/s34-post-audit-maintenance`. Source / starting SHA: `81256aaa0baefe65fac66f18e2a25e554808bd7b`.
- The S33 audit was on `fbdc30b`. Every finding was re-confirmed on the S34 baseline before it was changed.
- No database migration, no schema change, no new dependency, no secret change.

## S33-01 — Private records reaching the AI provider through history (P1)

- **Change:**
  - New `server/services/academic-assistant/private-boundary.ts`. `providerSafeTurns()` decides which turns may be sent using the stored `mode` and `private_refs` columns, not a heading.
  - `store.recentTurns` now returns those two columns.
  - `assistant-conversations/service.ts` hands only the projected turns to reply generation.
  - `providerSafeHistory` (inside `buildProviderMessages`) also strips any EN/FR appendix, as defence in depth for every caller.
  - `reply.ts` now takes its heads from one shared constant.
- **Why:** the stored message is what the student sees. What goes to the provider must be derived from it, and on failure the turn must be dropped.
- **Preserved:**
  - The student-visible private section and its links.
  - Local record answers.
  - The F01 empty record allowlist.
  - The PII guard, minor-safe prompts, budget handling and the conversation integrity chain (stored rows are untouched).
- **Detail:** `S34-PRIVACY-VERIFICATION.md`.

## S33-02 — Rate limits and office reliability (P1)

- **Change:**
  - One per-IP `/api` ceiling (1500 / 15 min).
  - Per-user limits after token verification inside `requireAuth`: 600 / 15 min for all requests, plus 300 for `/api/admin`.
  - The login limiter now counts failures only (10).
  - Separate refresh limiter (60).
  - Duplicate `apiRateLimit` mount removed.
  - Clean 429 JSON with `Retry-After`.
  - The client shows one friendly EN/FR 429 message.
  - A 429 on refresh never signs the user out.
  - A failed programs lookup shows a retry state instead of the university deck.
  - Review fix: a rate-limit store failure fails closed as 503 instead of 401.
- **Files:**
  - Server: `server/config/production.ts`, `server/middleware/rate-limit.ts`, `server/middleware/auth.ts`, `server/index.ts`, `server/routes.ts` (limiter lines only).
  - Client: `client/src/lib/{queryClient,api,auth,student-programs,rate-limit-message}.ts(x)`, `client/src/pages/flight-deck-router.tsx`, `client/src/i18n/modules/auth.ts`.
- **Preserved:** Redis-backed stores (new prefixes), fail-closed behaviour on store errors, `trust proxy` 1, signup/reset/verification limiters, and every authorization check.
- **Detail:** `S34-RATE-LIMIT-VERIFICATION.md`.

## S33-03 — Live AI provider failure (P1, operational)

- No code change.
- Read-only investigation: one synthetic request (no student data) to the pinned endpoint and model, using this session's connected `api.meta.ai` credential, returned **HTTP 402 `billing_not_configured`**: "Billing verification failed … your team needs to resolve a billing issue".
- The adapter handles this correctly: it maps the error to `http 402`, refunds the budget reservation and falls back to a local answer.
- Classification: **provider-account configuration (billing)**, not a code failure. Owner action is in `S34-OWNER-SUMMARY.md`.

## S33-04 — General questions answered from the student's record in local mode (P2)

- **Change:**
  - `service.ts`: the personal-question test now applies in both live and local modes.
  - `student-record.ts`: the `PERSONAL` markers were extended (deadlines, tasks, balance, behind, ahead, "où en suis", and so on), and the bare "roadmap" trigger was removed.
- **Effect:**
  - "What is a credit hour?" and « Qu'est-ce qu'un crédit ? » now get the curated explanation.
  - "How many credits have I earned?" and « Combien de crédits ai-je acquis ? » still get the grounded record answer.

## S33-05 — Transcript request raises no staff alert (P2)

- **Change:**
  - One derived rule, `transcript_requested`, in the existing S29 Needs Attention framework: `server/services/s29/rules.ts`, `fleet.ts`, `shared/s29-contract.ts`, `client/src/i18n/modules/s29-core.ts`.
  - One item per student, keyed `transcript_requested:<studentId>`.
  - It links to `/admin/students/<id>/high-school?tab=graduation` (the page honours `?tab=`).
  - It clears when the status leaves `requested`.
  - Review fix: its age is taken from the latest request event, so other graduation edits do not reset it.
- No new notification system and no transcript production.

## S33-06 — Legacy student-writable endpoints (P2)

- **Consumers:** verified that `dashboard.tsx` and `course-assignment-dialog.tsx` are not imported by any routed page.
- **Change in `server/routes.ts`:**
  - `POST /api/assignments` and `POST /api/generate-plan` refuse students with 403.
  - Staff and admin keep access.
  - The `details: error.message` field was removed from the 500 response.
  - `/api/system/check` now requires an administrator (401 when unauthenticated).
- The routes were kept rather than deleted (smallest change). No migration.

## S33-07 — Caught route errors never reach Sentry (P2)

- **Change:**
  - `server/lib/logger.ts`: `logger.error` forwards to a reporter registered by `server/lib/sentry.ts`.
    - Context is limited to an allowlist (method, redacted path, statusCode, event, route, code, service).
    - Each Error object is reported once.
    - A failing reporter is swallowed.
  - Review fixes:
    - 4xx errors are not forwarded.
    - The global handler is not double-reported (`errorReport: 'skip'`, and `res.sentry` / `wasErrorReported` checks).
    - E-mail addresses are masked in every Sentry event (`scrubSentryEvent`).
- No second observability system. The client-facing error format is unchanged.

## S33-08 — French assistant formatting (P2)

- **Change:** helpers `fmtDate`, `fmtDays`, `fmtItems` and `fmtMonths` in `degree-record.ts`, used by `student-record.ts`.
  - Dates read « 2 novembre 2026 » / "November 2, 2026" (UTC, fr-CA / en-US as on the client).
  - Plurals: « 1 jour », « 2 jours », « 0 jour », « 1 mois restant ».
  - English: "1 day", "2 days".
- Numbers and deadlines are unchanged.
- **Not changed:** the English billing due date (cosmetic; noted by the review).

## S33-09 — Backup and restore runbook (P2, documentation)

- `docs/s34/S34-BACKUP-RESTORE-RUNBOOK.md` covers:
  - who may restore;
  - backup sources, with daily backups and point-in-time recovery marked **REQUIRES OWNER VERIFICATION**;
  - verification steps;
  - app rollback versus database recovery;
  - restore into a separate project first;
  - record validation;
  - what to do if a restore fails;
  - avoiding overwriting newer data;
  - a drill.
- No restore was performed and nothing was purchased.

## S33-10 — Preferred name (P2)

- **Change:** `server/routes/student-welcome.ts` now uses the trimmed `preferred_name` when present, otherwise `first_name`. The welcome banner and the Flight Deck greeting therefore use the same name.
- Legal-name usage elsewhere and staff records are untouched.

## Preserved functionality

The following were not modified, apart from the specific changes listed above:
- Flight Deck, Roadmap, High School pages, Student File, Advanced Workspace, Control Center.
- Enrollment and owner-only linking, billing, Document Library, Support Desk, Calendar, Concierge.
- The assistant interface, Owner AI, Fleet AI, themes, the language controls and the assistant orb.

The independent review confirmed that account linking, the staff/admin split, credit calculations and school-identity confidentiality are untouched.
