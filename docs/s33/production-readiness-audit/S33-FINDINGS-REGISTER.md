# S33 — Findings Register

Baseline: `fbdc30b` (production `4ccd8ae` = `fbdc30b` + S32.1 support-desk refresh timing; see Evidence Index).
Confidence scale: **CONFIRMED** (reproduced or unambiguous code path), **PLAUSIBLE** (code supports it, runtime impact not measured), **UNVERIFIED**.
Every P1 below was re-checked by the lead reviewer; specialist claims that did not survive are listed under "Downgraded or rejected".

## Summary table

| ID | Title | Severity | Confidence | Recommendation |
|---|---|---|---|---|
| S33-01 | Private-records appendix reaches the AI provider through conversation history | P1 | CONFIRMED (reproduced) | Fix now (before student live AI is relied on) |
| S33-02 | Per-IP rate limits throttle ordinary staff/student use; 429 shown as raw English | P1 | CONFIRMED (config) / PLAUSIBLE (field impact) | Fix now, in the maintenance batch |
| S33-03 | Live AI provider failing in production; release not formally accepted | P1 (configuration) | CONFIRMED by S32 release log; cause UNVERIFIED | Owner action, then re-run acceptance |
| S33-04 | Without live AI, general questions get the student's own record instead of an explanation | P2 | CONFIRMED (reproduced) | Batch |
| S33-05 | High-school transcript request raises no staff alert | P2 | CONFIRMED | Batch |
| S33-06 | Legacy student-callable endpoints bypass the "staff manage the plan" rule (no live data effect) | P2 | CONFIRMED | Batch |
| S33-07 | Errors caught inside routes never reach Sentry | P2 | CONFIRMED | Batch |
| S33-08 | French assistant record answers use ISO dates and "jour(s)" hedges | P2 | CONFIRMED | Batch |
| S33-09 | No standing backup/restore runbook; restore never rehearsed | P2 | CONFIRMED (docs) | Owner verification + short runbook |
| S33-10 | Preferred name and legal first name shown side by side on the Flight Deck | P2 | CONFIRMED (code + S32 screenshot) | Batch |

---

## S33-01 — Private-records appendix reaches the AI provider through conversation history

1. **ID:** S33-01
2. **Title:** "From your records (private, not sent to any AI model)" text is sent to the AI model on the next turn.
3. **Role:** Student (high-school minors included).
4. **Workflow:** Academic Assistant, conversation page (`/assistant`), live mode.
5. **Severity:** P1.
6. **Confidence:** CONFIRMED — reproduced with the real functions (Evidence Index, R1).
7. **Evidence type:** code path + scripted reproduction.
8. **Source:**
   - `server/routes/assistant-conversations.ts:142` wires `createIntegratedGenerateReply({ retrievePrivate })`.
   - `server/services/assistant-conversations/reply.ts:64-78` (`composeWithPrivateContext`) appends private snippets (memory, earlier message snippets, document and course titles) to the reply `content`.
   - `server/services/assistant-conversations/service.ts:91-101` stores that combined content.
   - `store.ts:306-312` (`recentTurns`) returns it as history for the next question.
   - `server/services/academic-assistant/service.ts:168-178` (`providerSafeHistory`) drops only assistant turns that **start** with the record-answer head. A live answer with the private section appended starts with model text, so it passes the filter.
9. **Reproduction:**
   1. Student live mode is on.
   2. The student asks a general question, e.g. "What is a syllabus?". The live answer is stored with "From your records (private…): - Passport scan … — uploaded …" appended.
   3. The student asks a follow-up question.
   4. `buildProviderMessages` output contains the private appendix. Scripted check: `provider body contains private appendix: true`.
10. **Expected:** nothing from the student's records is sent to the provider (the S32-A F01 policy, `service.ts:152-158`).
11. **Actual:** up to 3 private snippets per earlier turn are sent, within the 6-turn history window.
12. **Business impact:**
    - Personal data of minors goes to an external, training-enabled provider tier, against the documented policy and against the text shown to the student.
    - Reputational and regulatory exposure.
    - Today the provider is failing (S33-03), so no data is leaving right now.
13. **S31/S32 coverage:** S32-A F01 fixed the direct `answerMessage` path, and the privacy test (`tests/s32a-assistant-review-fixes.test.ts`) covers it. The conversation-page appendix path was not covered.
14. **Smallest correction:** in `composeWithPrivateContext`, keep the appendix out of the stored provider-visible text; or have `providerSafeHistory` strip everything from the `PRIVATE_T.*.head` line onward. The latter is about 10 lines.
15. **Effort:** about 1–2 hours including a test.
16. **Regression test:** compose a live reply with a private appendix, then assert that `buildProviderMessages` on the next turn contains no appendix text (EN and FR heads).
17. **Initial-launch impact:** none while student live AI is off or the provider is down. Becomes active when the provider recovers if `SPARK_ASSISTANT_LIVE_ROLES` includes `student`. The S32 release log reports a student-side "AI model was unavailable" notice, which indicates student live mode is configured.
18. **Recommendation:** **fix now**. Until fixed, the owner should remove `student` from the live roles.

## S33-02 — Per-IP rate limits throttle ordinary use; 429 is not explained

1. **ID:** S33-02
2. **Title:** request limits are per network address and sized for attacks, not for an office.
3. **Role:** Administrator, staff and coach (shared office network); also students on a shared school or home network.
4. **Workflow:** every authenticated screen; sign-in and session renewal.
5. **Severity:** P1.
6. **Confidence:** limits CONFIRMED in code. The field impact is PLAUSIBLE, strongly supported by S32's own release log.
7. **Evidence type:** configuration + release evidence.
8. **Source:**
   - `server/config/production.ts:120-140`: `api` 100 / 15 min; `admin` **30 / 15 min**; `auth` 5 / 15 min.
   - Applied per IP at `server/index.ts:240-242`. `server/routes.ts:146` adds a second 100 / 15 min API counter.
   - `server/middleware/rate-limit.ts:15-37`: login **and token refresh** share the 5 / 15 min auth bucket (`routes.ts:541, 568`).
   - Client: `client/src/lib/queryClient.ts:5-9` and `client/src/lib/api.ts` have no 429 handling, so the user sees a raw `429: {"error":"Too many requests…"}` or English server text.
   - Session renewal (`client/src/lib/auth.tsx:221-262`) treats a 429 refresh as "try later". If the token expires before the bucket resets and an API call returns 401, the user is signed out.
9. **Reproduction (static):**
   - The S26 acceptance runner reserves about 14 `/api` requests per browser page (`scripts/s26/production-acceptance.ts:1219`), roughly 7 page views per 15 minutes for everyone behind one IP.
   - Admin Diagnostics polls every 60 s (`client/src/lib/s29-ops-queries.ts:47`), using 15 of the 30 admin requests per open tab.
   - At `fbdc30b` the hosted acceptance run "used 104 API requests against 100 per 15 minutes", and the admin browser pages fell back to the sign-in form (`docs/s32/staff-repairs/S32-RELEASE-READINESS.md`, live release log).
10. **Expected:** two or three people can work in the Portal at the same time all day without errors.
11. **Actual:**
    - Within minutes of concurrent Student File work, `/api/admin/*` returns 429 "Too many admin requests".
    - Five sign-ins from one office within 15 minutes block the sixth sign-in and everyone's token renewal.
12. **Business impact:**
    - Intermittent "broken" screens and occasional forced sign-outs during normal work.
    - Errors are in English with JSON, including for French users.
    - Erodes trust in the S32 staff repairs.
    - Secondary symptom: a high-school student whose programs lookup fails transiently is shown the university Flight Deck and its "plan not ready" state (`client/src/lib/student-programs.ts:48-66`, `client/src/pages/flight-deck-router.tsx`).
13. **S31/S32 coverage:** not covered. S32.1 reduced the desk's polling to stay under the limit but did not revisit the limits themselves.
14. **Smallest correction:**
    - (a) Key the `api` and `admin` limiters by authenticated user id where available, falling back to IP, and raise them (e.g. 600 / 15 min per user).
    - (b) Give `/api/auth/refresh` its own generous limiter, keeping login strict.
    - (c) Remove the duplicate `apiRateLimit` mount.
    - (d) Map 429 to one translated message ("Too many requests — wait a minute and try again") in both client fetch helpers.
15. **Effort:** about half a day including tests.
16. **Regression test:**
    - Limiter wiring test: refresh is not in the auth bucket, and the admin limiter key uses the user id.
    - UI test: a 429 renders the translated message.
17. **Initial-launch impact:** low with a single owner working alone. Material as soon as two or three people work concurrently, or the owner keeps Diagnostics open.
18. **Recommendation:** **fix now**, in the maintenance batch.

## S33-03 — Live AI provider failing in production (configuration)

1. **ID:** S33-03
2. **Title:** Owner AI and student live answers have returned `provider_error` since 2026-11-01.
3. **Role:** Administrator (Owner AI, Fleet); students (live answers).
4. **Workflow:** Owner AI answers and drafts; student assistant live mode.
5. **Severity:** P1 (operational, configuration; not a code defect).
6. **Confidence:** the failure is CONFIRMED by the S32 release log (two runs, 45 minutes apart). The cause is UNVERIFIED.
7. **Evidence type:** release record.
8. **Source:**
   - `docs/s32/staff-repairs/S32-RELEASE-READINESS.md` §5.
   - The provider adapter and pinned model are unchanged since `31c3a1f`, which passed.
9. **Reproduction:** hosted acceptance checks `admin.owner-ai-answer-en` and `admin.owner-ai-draft-reply-fr`.
10. **Expected:** live answers.
11. **Actual:** fallback answers with a notice. No data loss and no wrong answers.
12. **Impact:** the owner loses AI drafting and portfolio answers. Students get built-in answers only. The release is formally "not yet fully accepted".
13. **S31/S32 coverage:** recorded by S32 as open.
14. **Smallest correction:** owner checks `META_MODEL_API_KEY`, account credits and quota, and the production deployment log for the provider's actual error; then re-runs the S26 acceptance.
15. **Effort:** owner time only.
16. **Regression test:** the existing hosted acceptance AI checks.
17. **Launch impact:** degraded but safe.
18. **Recommendation:** **owner action now.** Do not change code for this.

## S33-04 — Without live AI, general questions are answered with the student's own record

- **Role / workflow:** Student / Academic Assistant (orb and conversation page), local mode. Local mode is the current production reality because of S33-03, and the default when live AI is off.
- **Severity:** P2.
- **Confidence:** CONFIRMED (reproduced, R2).
- **Evidence:** `server/services/academic-assistant/service.ts:253-254`: `if (recordAnswer && (!decision.live || isPersonalQuestion(message))) return recordAnswer;`. The personal-question test applies only in live mode.
- **Reproduction:** local mode, FR student asks « Qu'est-ce qu'un crédit ? ». The reply is "D'après votre dossier… • Earned 3.0 of 24 credits". "What is a credit hour?" behaves the same way.
- **Expected:** a general explanation from the knowledge base.
- **Actual:** the student's own credit line.
- **Impact:** a confusing non-answer. Not a privacy issue: the data is the student's own and is shown locally.
- **S32 coverage:** S32 deliberately kept the record-first behaviour for local mode (code comment "as before S32"). The brief's check 2 ("general questions not answered with unrelated personal records") holds only in live mode.
- **Smallest fix:** apply `isPersonalQuestion` in both modes and fall through to `localAnswer` otherwise. One line, plus tests for EN and FR general questions in local mode.
- **Effort:** under an hour.
- **Recommendation:** batch.

## S33-05 — High-school transcript request raises no staff alert

- **Role / workflow:** Completed high-school student → staff / graduation.
- **Severity:** P2.
- **Confidence:** CONFIRMED.
- **Evidence:**
  - `server/services/high-school-service.ts:590-628` records `transcriptStatus: requested`, an event and an audit entry.
  - Needs Attention has no transcript kind (`server/services/s29/rules.ts:55-74`, the `WORKFLOW`/`ACTION` maps).
  - No email or inbox notification is sent.
  - Staff see the request only in that student's High School page (`client/src/components/admin/high-school/events-section.tsx:7`, `graduation-section.tsx:156`).
- **Reproduction:** student with graduation eligibility confirmed → Flight Deck graduated panel → "Request transcript". The Control Center shows nothing.
- **Expected:** a Needs Attention item ("Transcript requested").
- **Actual:** silent.
- **Impact:** a graduate waits with no follow-up until someone happens to open the file. Low frequency, high personal importance.
- **Smallest fix:** add a `transcript_requested` rule (`transcriptStatus = 'requested'`) linking to the HS graduation section. It clears when staff set the status.
- **Effort:** about 2 hours.
- **Launch impact:** none for the first student (graduation is months away).
- **Recommendation:** batch.

## S33-06 — Legacy student-callable endpoints

- **Role:** Student (authenticated, direct API calls only; no current screen uses these).
- **Severity:** P2.
- **Confidence:** CONFIRMED.
- **Evidence:**
  - `POST /api/assignments` (`server/routes.ts:1041-1079`) lets any signed-in user insert rows into the legacy `enrollments` table with arbitrary title and credits. The sibling `/api/enrollments` refuses students (`routes.ts:884`).
  - `POST /api/generate-plan` (`routes.ts:1242-1310`) rewrites legacy `roadmap_plans`/`roadmap_steps`, and its 500 response returns `details: error.message`.
  - `/api/system/check` (`routes.ts:1209`) is unauthenticated.
- **Adversarial check:**
  - The legacy `enrollments` table is read only by `assignment-service`, `enrollment-service` and the legacy `flight-deck-service`.
  - The canonical roadmap (`student_roadmap_plans`), HS records, degree progress, Control Center and assistant do not read it.
  - The client dialogs that call these routes (`course-assignment-dialog.tsx`, `pages/dashboard.tsx`) are not imported by any routed page.
  - **There is therefore no effect on what students or staff see.** This was downgraded from the specialist's P1.
- **Impact:** policy inconsistency and attack surface; a future change could start reading the legacy table.
- **Smallest fix:** refuse `role === 'student'` on these two routes (as `/api/enrollments` does), drop `details`, require auth on `system/check`; or delete the legacy routes.
- **Effort:** about 1 hour.
- **Recommendation:** batch.

## S33-07 — Errors caught inside routes never reach Sentry

- **Severity:** P2.
- **Confidence:** CONFIRMED.
- **Evidence:** `server/lib/logger.ts` has no Sentry hook. `captureException` is called only in `server/index.ts` (5 call sites). Most handlers catch, call `logger.error`, and return 500.
- **Impact:** production 500s are visible only in the Replit console, so problems surface only when someone complains.
- **Smallest fix:** forward `logger.error` (with the existing redaction) to `Sentry.captureException` when Sentry is configured.
- **Effort:** about 1 hour.
- **Recommendation:** batch.

## S33-08 — French assistant record answers use ISO dates and "(s)" plurals

- **Severity:** P2 (cosmetic, French-first).
- **Confidence:** CONFIRMED.
- **Evidence:** `server/services/academic-assistant/student-record.ts:155, 161, 180`. Examples: « à remettre le 2026-11-02, 3 jour(s) restant(s) », « élément(s) », « mois restant(s) ». The screens were fixed in S32 (F28); the assistant text was not.
- **Smallest fix:** a small `fmtDate(lang)` plus plural helper in `student-record.ts` / `degree-record.ts`.
- **Effort:** about 1–2 hours.
- **Recommendation:** batch.

## S33-09 — No standing backup/restore runbook

- **Severity:** P2.
- **Confidence:** CONFIRMED (documentation).
- **Evidence:** the only restore procedure is the one-off `docs/release/s14/RUNBOOK.md`. There is no current document for the Replit and Supabase setup, and no record of a restore drill.
- **Impact:** if data is lost or corrupted, recovery depends on memory and improvisation.
- **Smallest fix:**
  - Owner confirms that Supabase point-in-time recovery or daily backups are enabled.
  - One page records how to restore and who does it.
  - Optionally, one rehearsal into a scratch project.
- **Effort:** about 2 hours.
- **Recommendation:** batch; the owner verification can happen now.

## S33-10 — Preferred name and legal first name shown together

- **Role / workflow:** Student / Flight Deck first login.
- **Severity:** P2.
- **Confidence:** CONFIRMED (code + S32 screenshot).
- **Evidence:**
  - The greeting uses `preferredName || firstName` (`client/src/pages/high-school-flight-deck.tsx:130`).
  - The welcome banner uses `students.first_name` only (`server/routes/student-welcome.ts:151`).
  - S32 screenshot `docs/s32/student-repairs/evidence/after/first-hs-flight-deck-fr-390-light.png` shows « Bonsoir, Amy. » directly above « Bienvenue chez Lumière, Noa ! ». The names come from fixtures, but the two fields are genuinely different.
- **Impact:** a student who uses a preferred name is addressed by two names on their first screen. This is confusing, and can be sensitive if the preferred name matters to them.
- **Smallest fix:** the welcome endpoint returns `preferred_name || first_name`. One line, plus a test.
- **Effort:** under an hour.
- **Recommendation:** batch.

---

## Deferred / no change (explicitly rejected or deferred proposals)

| # | Proposal | Decision | Reason |
|---|---|---|---|
| D1 | Replace the "PROPOSED / APPROVAL PENDING / TEST ONLY" course-title markers that drive the electives-awaiting chip (`client/src/components/s27/flight-deck.tsx:69`) | NO CHANGE | An established staff convention, applied consistently in `lib/elective-change.ts` and the assistant. It only misfires if a real course title contains "Proposed". |
| D2 | Remove English-only branches of the legacy roadmap views (`student-roadmap-views.tsx` published branch, `HorizonSection`) | DEFER | Not reachable by students today (published plans route to the Degree deck/journey). Clean up only when that code is touched. |
| D3 | A PII-flagged turn makes the next ~6 questions return the privacy notice | DEFER | Safe (fails closed), PLAUSIBLE only; wait for a real report. |
| D4 | Concurrent double-confirm of payment proof returns a generic error | DEFER | The DB unique index prevents a double receipt, so there is no money risk. |
| D5 | `/health` exposes environment, uptime and memory | DEFER | Low sensitivity; needed by the release runner. |
| D6 | `uploadRateLimit` defined but unused | DEFER | Uploads are authenticated and size-limited; no evidence of abuse. |
| D7 | Restrict billing record/void/confirm to administrators | NO CHANGE | Staff handling billing is an intended policy (owner decision 3 in S32); the audit trail exists. |
| D8 | Email the administrator when an account is ready to link | NO CHANGE | The Needs Attention item already exists and escalates after 2 days. |
| D9 | Make DOB/phone/address optional for prospects | DEFER | Needs a migration; S32 chose not to. Low frequency. |
| D10 | Merge the Student File and the Advanced Workspace | NO CHANGE | Different permissions and audit scope; S32 already added clear cross-links. |
| D11 | Build an enrollment wizard | NO CHANGE | The current derived enrollment status plus queue item is adequate; no dead end found. |
| D12 | PWA, native app, push notifications, Stripe or online payments, another chatbot | NO CHANGE | No evidence of user need for the pilot; the support-based payment fallback is adequate. |

## Downgraded or rejected specialist candidates

- **`/api/assignments` "students can inject credits" (proposed P1) → S33-06, P2.** The table it writes is not read by any live academic view (see the adversarial check above).
- **Login and refresh sharing one bucket (proposed separate P1) → merged into S33-02.** It has the same root cause and the same fix batch.
- **"429 shows no useful message" (proposed separate P1) → merged into S33-02.** It is a symptom of the same cause.
- **Programs lookup fallback showing the university deck → merged into S33-02** as a transient symptom.
- **Local-mode record answers (proposed P1 when pilot students ask definitional questions) → P2.** No privacy effect, and the behaviour is a deliberate S32 choice.

## Unverified items (not defects)

| # | Item | What would verify it |
|---|---|---|
| U1 | Cause of the AI provider failure | Production deployment log; provider dashboard |
| U2 | Real invitation and password emails delivered (Resend), and French Supabase auth templates | Send a synthetic invitation to an owner mailbox |
| U3 | `REDIS_URL` set; number of instances | Diagnostics → rate-limit backend tile |
| U4 | Replit forwards the real client IP (`trust proxy 1`) | Compare `req.ip` in logs from two networks |
| U5 | Supabase backups / PITR enabled | Supabase dashboard |
| U6 | Full French journey in a real browser against production | Hosted acceptance + manual walkthrough |
| U7 | Real-device mobile rendering (390/768/1440) of the current build | S32 screenshots inspected only; no new capture |
| U8 | Live coach/staff/admin role boundaries on production | Hosted acceptance role checks (reported passing at `4ccd8ae`) |
| U9 | Exact `/api` requests per page load | Browser network trace (S33-02 uses static and runner estimates) |
