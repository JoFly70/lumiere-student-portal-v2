# S32 — Combined Findings Matrix (71 original findings)

Sources:
- Student audit (S31-A): `docs/s31/student-audit/STUDENT-FINDINGS-REGISTER.md`, 34 findings (F01–F34).
- Staff audit (S31-B): `docs/s31/staff-audit/STAFF-FINDINGS-REGISTER.md`, 37 findings (SA-01–SA-37).

Per-finding detail (root cause, files, tests, before/after):
- `docs/s32/student-repairs/S32-A-FINDINGS-RECONCILIATION.md`
- `docs/s32/staff-repairs/S32-B-FINDINGS-RECONCILIATION.md`

## Totals

| | Student (F) | Staff (SA) | Total |
|---|---|---|---|
| Findings | 34 | 37 | **71** |
| FIXED | 33 | 36 | 69 |
| DUPLICATE RESOLVED | 1 (F19) | 1 (SA-18) | 2 (one defect, fixed once, both IDs point to it) |
| VERIFIED ALREADY CORRECT | 0 | 0 | 0 |
| Unresolved, deferred or blocked | 0 | 0 | **0** |

By severity:
- Student: High 6, Medium 20, Low 8.
- Staff: High 7, Medium 17, Low 13.

**Duplicate pair.**
- F19 (student sign-up errors) and SA-18 (signup errors, from the staff support-load view) are the same defect.
- One implementation is shipped:
  - S32-A `client/src/components/auth/signup-errors.ts` (translated messages, sign-in and reset links);
  - S32-B `client/src/lib/auth.tsx` preserves the server code;
  - `PASSWORD_TOO_SHORT` and the exact-email recovery wording are added.
- Integration commit: `95dd004`.

**Cross-session dependencies, all closed:**
- F20 / F30: the S29 templates patch was applied with its regression test (`95dd004`).
- F19: the code-preserving sign-up error.
- F01: hosted assistant mode check. This is a post-release observation only; see `S32-RELEASE-READINESS.md`.

## Matrix

| ID | Severity | Finding | Status | Where fixed |
|---|---|---|---|---|
| F01 | High | Live AI for students: documented policy and configured policy disagree; in live mode the student's records (ticket subjects, billing amounts, document names) go to a training-enabled provider | FIXED | S32-A caac94c, 7771fb3 |
| F02 | High | The assistant refuses "Où en sont mes crédits ?", "What is my balance?", « Explique-moi ma feuille de route » with a privacy warning | FIXED | S32-A caac94c, 7771fb3 |
| F03 | High | The assistant has no degree data, but the degree Flight Deck promises answers "from your record" | FIXED | S32-A caac94c |
| F04 | High | The degree Roadmap "Completed" header counts credits the university has not accepted | FIXED | S32-A f11a0f3 |
| F05 | High | Billing never says how to pay; the proof link appears only while evidence is awaiting; the next or overdue amount is not on the phone's first screen | FIXED | S32-A f11a0f3, caac94c, dc00f6a |
| F06 | High | The "plan not ready" and "could not load" screens are English only | FIXED | S32-A caac94c, f785787, 7ee1e54 |
| F07 | Medium | Credit vocabulary differs between screens (« Appliqués » / « Déjà acquis » / the KB's Official/Reported) | FIXED | S32-A caac94c, f785787, 7ee1e54 |
| F08 | Medium | Server-built English labels on French screens: dashboard deadline cards and the profile readiness checklist | FIXED | S32-A caac94c |
| F09 | Medium | Library never shows why a document was rejected | FIXED | S32-A caac94c, dc00f6a |
| F10 | Medium | Uploading from Documents "All" files the document as a high-school transcript (bachelor's too) | FIXED | S32-A caac94c, 75861d1, dc00f6a |
| F11 | Medium | Elective change is not reachable from the default course page; the assistant points to a missing button; ticket text is English | FIXED | S32-A f11a0f3, caac94c |
| F12 | Medium | The first-login welcome is orphaned | FIXED | S32-A caac94c |
| F13 | Medium | Assistant intents don't cover the suggested questions; "How much do I owe?" goes to Documents; « prochain examen » unmatched | FIXED | S32-A caac94c, 7ee1e54, 7771fb3 |
| F14 | Medium | Flight-path milestone labels overlap | FIXED | S32-A f11a0f3 |
| F15 | Medium | "Behind plan" ignores work awaiting the school's result | FIXED | S32-A caac94c |
| F16 | Medium | High-school wording on the bachelor's Flight Deck | FIXED | S32-A caac94c |
| F17 | Medium | Degree graduation planning is thin: "Still open" ignores requirement gaps; Beyond intake year comes from today | FIXED | S32-A caac94c |
| F18 | Medium | Requesting an appointment is hidden and labelled as a booking | FIXED | S32-A caac94c |
| F19 | Medium | Sign-up errors appear as raw English server text; no sign-in or reset link for a duplicate email | DUPLICATE RESOLVED (with SA-18) | S32-A caac94c + shared fix `2ba1708`/`95dd004` |
| F20 | Medium | Notification texts frozen in creation language; two point to the wrong place | FIXED | S32-A caac94c + shared patch applied in S32-B `95dd004` |
| F21 | Medium | Notification badge contrast is too low | FIXED | S32-A caac94c |
| F22 | Medium | No contact route for a signed-out student | FIXED | S32-A caac94c |
| F23 | Medium | French-locale browsers get English on the first visit | FIXED | S32-A f11a0f3 |
| F24 | Medium | Three names for Support in French; three titles for the course page; lycée/secondaire; e-mail/courriel | FIXED | S32-A caac94c, dc00f6a |
| F25 | Medium | The assistant's knowledge base is not filtered by program | FIXED | S32-A caac94c |
| F26 | Medium | No path from "I finished at the provider" to sending evidence | FIXED | S32-A f11a0f3, 75861d1 |
| F27 | Low | The floating orb covers the last card text on phones | FIXED | S32-A f11a0f3 |
| F28 | Low | French formatting: « déc.. », « dans 1 jours », « 1 oct. » | FIXED | S32-A caac94c |
| F29 | Low | English screen-reader strings: mobile "Sidebar" sheet, Close, toast region, avatar label | FIXED | S32-A caac94c |
| F30 | Low | Masculine participles with « pièce d’identité » in notifications | FIXED | S32-A caac94c + shared patch applied in S32-B `95dd004` |
| F31 | Low | No "graduated" state on the HS Flight Deck; transcript request only in the details view | FIXED | S32-A f11a0f3, caac94c |
| F32 | Low | No `theme-color`; viewport lacks `viewport-fit=cover` | FIXED | S32-A caac94c |
| F33 | Low | Dead code: `public/index.html`, root `index.html`, `dashboard*.tsx`, `support-old.tsx`, `roadmap-view.tsx`, `flight-deck-view.tsx`, `student-home.tsx` | FIXED | S32-A b9e19fc, 75861d1 |
| F34 | Low | Record-fact answers labelled "not based on a Lumière source" | FIXED | S32-A caac94c |
| SA-01 | High | Staff-only calendar events still send the student a reminder | FIXED | S32-B 67a5e91 |
| SA-02 | High | Staff hit dead ends wherever a link opens a student record | FIXED | S32-B 2ba1708, ac65b63 |
| SA-03 | High | Staff are allowed to review documents (and identity and guardian decisions) on the server but have no screen to do it, so the owner is the only reviewer | FIXED | S32-B 2ba1708, 0da690f, 775f560 |
| SA-04 | High | The highest-volume queue item, "Reply to the ticket", links back to the Control Center itself | FIXED | S32-B 2ba1708 |
| SA-05 | High | Some audit records may not be written, and the student Activity feed misses several decisions | FIXED | S32-B 239ab45 |
| SA-06 | High | "Profile & identity" and "Documents" hash links land on the wrong screen | FIXED | S32-B 0da690f |
| SA-07 | High | Enrollment does not connect invitation, account and student | FIXED | S32-B d977021, 0da690f, 141d6ad |
| SA-08 | Medium | A brand-new lead's Student File says "Nothing is waiting on you" | FIXED | S32-B 0da690f |
| SA-09 | Medium | The two workspaces are hard to tell apart and the Workspace has no way back | FIXED | S32-B 0da690f, 239ab45, 15fb09c |
| SA-10 | Medium | Proof of payment is entered twice | FIXED | S32-B 294e1a1 |
| SA-11 | Medium | Staff cannot list who owes money; the billing start page shows only the 12 newest students | FIXED | S32-B 294e1a1 |
| SA-12 | Medium | Support search only matches the subject; staff cannot see a student's other tickets | FIXED | S32-B ac65b63, 0da690f |
| SA-13 | Medium | Staff have no inbox; reminders and alerts addressed to staff are written but never shown | FIXED | S32-B 67a5e91, 2ba1708 |
| SA-14 | Medium | Turning the Concierge off does not stop reminder emails to students | FIXED | S32-B 67a5e91 |
| SA-15 | Medium | The Control Center shows three different "needs you" numbers, and dismissals do not change them | FIXED | S32-B 2ba1708 |
| SA-16 | Medium | The staff shell and several staff screens are English-only; staff have no language switch | FIXED | S32-B 2ba1708, 294e1a1, ac65b63, 239ab45, 15fb09c, bf9c057, 5d4e45e |
| SA-17 | Medium | Administration has no last-admin guard, logs the wrong old role, and has no deactivate button | FIXED | S32-B 239ab45, 141d6ad |
| SA-18 | Medium | Signup errors are English-only and one message covers five different causes | DUPLICATE RESOLVED (with F19) | S32-B 2ba1708, 95dd004 |
| SA-19 | Medium | After signing in, staff land on their home page instead of the link they opened | FIXED | S32-B 2ba1708 |
| SA-20 | Medium | Staff and coaches land on the Support desk, not the Control Center | FIXED | S32-B 2ba1708 |
| SA-21 | Medium | Owner AI citation links point to a page that does not exist | FIXED | S32-B 0da690f |
| SA-22 | Medium | Billing history shows 12 entries, no names, and omits price and schedule changes | FIXED | S32-B 294e1a1 |
| SA-23 | Medium | Imports that staff validated wait silently for owner approval | FIXED | S32-B 67a5e91 |
| SA-24 | Medium | The audit log viewer is too thin to answer "who did what" | FIXED | S32-B 239ab45 |
| SA-25 | Low | "Activate lead" is implemented three times. The File version has no confirm and no success feedback and shows raw server errors. The FR label "Activer la préinscription" reads as the opposite of the action. `students.status` gates nothing. | FIXED | S32-B 0da690f |
| SA-26 | Low | The contract gates hard-code 30/90 days and 9 months, while the agreement values are editable. "Agreement signed" is derived from a verified consent document in one place and from `signed_on` in another. | FIXED | S32-B 0da690f |
| SA-27 | Low | Dead code and stale copy: `control-center-live.tsx` (unused), unused billing panels, the Administration banner describing the retired "Support Center", and the "Activity feed not connected" placeholder. | FIXED | S32-B 239ab45, 294e1a1 |
| SA-28 | Low | Ask Lumière chips send `?q=`, which the Owner AI page ignores, and they ask portfolio questions that only the (off) Fleet copilot answers. | FIXED | S32-B 2ba1708 |
| SA-29 | Low | `notification_failed` links with `?state=failed`, which is ignored. `tab=roadmap` sends degree students to the HS page or Overview. | FIXED | S32-B 67a5e91, 2ba1708, db59142 |
| SA-30 | Low | Document "Verify" is one click with no confirm. Recovery exists (reject afterwards). | FIXED | S32-B 775f560 |
| SA-31 | Low | Elective requests are admin-only although staff see elective items and tickets. The page makes N+1 requests (up to 100). | FIXED | S32-B ac65b63, 2ba1708 |
| SA-32 | Low | Add student requires DOB, phone and address even for a prospect. A duplicate email shows "Failed to create student". | FIXED | S32-B 239ab45 |
| SA-33 | Low | Invitation resend reuses the issue form's language and send-email choice. The account-card invite is hard-coded to FR and does not revoke older codes. | FIXED | S32-B 239ab45, 0da690f, 15fb09c, 141d6ad |
| SA-34 | Low | Staff Control Center error state offers "Open the students" (bounces) and shows the raw server error text. | FIXED | S32-B 2ba1708 |
| SA-35 | Low | Signup password minimum is 6 characters. | FIXED | S32-B 2ba1708, 95dd004 |
| SA-36 | Low | The coach header shows a student search that always returns nothing. | FIXED | S32-B 2ba1708 |
| SA-37 | Low | Support desk does not refresh. Assignment and priority changes notify nobody. The coach "Unassigned" tile is always 0. | FIXED | S32-B ac65b63 |
