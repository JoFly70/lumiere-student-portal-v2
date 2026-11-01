# S32-B — Regression Results (combined S32 candidate)

## 1. Production-critical functions

| Area | How checked | Result |
|---|---|---|
| Sign-in, sign-up, reset | `routes.test.ts`, `s19-login`, `phase5e-auth-policy`, `s32b-staff-units`, S32-A `s32a-services-misc` | Pass. The new-password minimum is now 10 (intended). Existing passwords still sign in. |
| Role guards: student, coach, staff, admin | `s32b-staff-boundaries-http` (full app), `s07-security-http`, `phase5d-router-ownership`, `s08-support-routes`, BR crawl | Pass. The only widening is the client route gate for staff on the Student File and directory. The server is unchanged, and the server-side admin-only set is pinned by test. |
| Control Center and Needs Attention | `s27-*`, `s29-*`, `s32b-cc-menu`, BR | Pass. Counts unified; links land. |
| Documents (review, upload on behalf) | `s19-staff-document-review`, `phase5d-documents-support`, BR | Pass. Verify still one click, now with a toast. |
| Billing (obligation, instalments, receipts, evidence, voids) | `s19-staff-billing`, `s28-onboarding-http`, `s32-billing-*` | Pass. Guards unchanged: sum = net, paid-instalment lock, void with reason. No balance changes. |
| Support (queue, replies, attachments, coach scope) | `s08-*`, `s10-support-client`, `s19-support-reply-idempotency`, `s32b-support-*` | Pass. Coach still assigned-only; students only their own tickets. |
| Calendar and reminders | `s30-units`, `s30-calendar-http`, `s30-calendar-ui`, `s29-intelligence-db`, `s32b-ops-units` | Pass. Expectations updated for SA-01 / SA-13 / SA-14 (intended). |
| Imports | `s30-imports-*`, `s30-phase-b-fixes-*` | Pass. Approve, commit and rollback stay admin-only. |
| Placements | `phase5c1-admin-student-credit-placement-routes`, `phase5c2-controlled-placement-ui`, `phase5a1-admin-student-workspace` | Pass. Routes and UI flow unchanged. |
| Owner AI and Fleet | `s26-owner-assistant`, `s27-assistant-context`, `s30-phase-c-*` | Pass. Citations now land; Fleet stays off by default. |
| Student experience (S32-A) | `s32a-*` (11 files) and the full suite | Pass after integration |
| Themes, brand, colours | `s19-themes-parity`, `s19-brand` | Pass. No raw hex added; no red; umber and sage tokens only. |

## 2. Tests changed on purpose (old behaviour → S32 behaviour)

| Test | Old assertion | New assertion | Why |
|---|---|---|---|
| `s27-owner-presentation` | staff file link → `/support` | staff keep the file link; workspace → file; elective → its ticket | SA-02 / SA-03 |
| `phase5f-production-truth-routing`, `s19-login` | literal landing redirects | `roleHomePath` / `takeReturnPath` | SA-19 / SA-20 |
| `s10-staff-pass`, `s10-support-client`, `s10-correctness-regressions`, `phase5f` | literal English menu and portal label | translated menu with stable test ids | SA-16 |
| `s09-staff-profile-review`, `s11-hs-staff-ui` | `#workspace-documents`, `#workspace-profile` on the File | `?tab=documents`; guardian decision in the Workspace (admin) | SA-06 |
| `s03-invitations-account-status` | insert only | insert, then revoke older unclaimed codes | SA-33 |
| `routes.test.ts` | "at least 6 characters" | 10 + `PASSWORD_TOO_SHORT` | SA-35 |
| `s30-units`, `s30-calendar-http`, `s29-intelligence-db` | admin reminder rows; reminders without the Concierge | student-only, Concierge-gated | SA-13 / SA-14 |
| `s08-support-routes`, `phase5d-router-ownership` | staff 403 on `studentId`; no `student_id` | staff allowed; coach and student still refused | SA-12 / SA-02 |
| `phase5f` (admin placeholder) | placeholder present | absent | SA-27 |
| `s27-orb-viewas` | « Voir comme l’élève » | « Voir comme l’étudiant » | terminology |

## 3. Independent review findings and their fixes (`141d6ad`)

| # | Finding (Low) | Fix |
|---|---|---|
| 1 | Correcting the record email left codes sent to the old address live | Same transaction revokes unclaimed codes for the previous email |
| 2 | Invitation supersede was not atomic | Insert first, then revoke only older codes (`neq id`, `lt created_at`): never zero live codes, and the newer of two concurrent issues wins |
| 3 | Last-admin race when two admins demote or archive each other | Re-check after the write; revert and return 409 if no active admin remains |
| 4 | Account link, unlink and email POSTs had no CSRF | `requireCsrf` added (the client `apiRequest` already sends the token) |
| 5 | Concurrent email correction returned 500 | Unique violation mapped to 409 `STUDENT_EMAIL_TAKEN` |
| 6 | `roleSafeHref` let `/\host` through for admins | Backslash and control characters rejected |
| 7 | A quote in the admin user search broke the PostgREST `or()` | `"` stripped |
| 8 | Two fixtures used real-domain emails | Replaced with non-routable synthetic domains |

## 4. Regressions found during S32 integration and fixed

- **S32-A and S32-B each fixed sign-up errors (F19 / SA-18).** Kept one implementation (S32-A's `signUpErrorInfo`, fed by S32-B's code-preserving `auth.tsx`) and removed the duplicate.
- **French terminology drift** (« élève » vs « étudiant ») between workers. Normalised.
- **English status pill on the French Student File.** Translated.
