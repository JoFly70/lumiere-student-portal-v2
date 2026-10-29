# S26 ADDENDUM — DIRECT END-TO-END PRODUCTION RELEASE AUTHORIZED

**Owner approval: APPROVED — proceed through production release without another checkpoint.**

**Issued:** October 29, 2026 (America/Chicago)
**Repository:** `JoFly70/lumiere-student-portal-v2`
**Execution branch:** `claude/s26-owner-and-first-student-finish`
**Applies to:** 
- `docs/recovery/S26-OWNER-FIRST-STUDENT-FINISH.md`
- `docs/recovery/S26-FIRST-STUDENT-SYNTHETIC-21-CREDIT-PLAN.md`
- GitHub issue #12

## 1. OWNER OVERRIDE — READ BEFORE EXECUTION

The owner expressly directs:

> "it can go straight into production noi need to stop"

**This addendum supersedes every earlier S26 instruction requiring:**
- a staging-only implementation;
- an additional owner approval before publishing production;
- a stop after local or staging tests;
- a final engineering review meeting or release-preparation phase before deployment.

**New binding objective:** Deliver the COMPLETE functioning owner/staff/student experience, apply necessary safe production updates, deploy to the currently published production Replit application, and prove the actual production flows **in the same continuous execution**. No separate plan-only session or approval round. Owner does not need to approve routine code changes, additive/reversible DB migrations, configuration updates that are clearly in scope, or publishing this approved release.

**The owner has authorized production launch, not knowingly unsafe execution.** If a specific destructive data migration, irreversible operation, credential exposure, serious authorization flaw, verified loss of production data, or other concrete security/data-loss problem is encountered, the engineer must stop THAT unsafe action, preserve the previous working deployment, report the exact failure, and continue independent safe work. This is not permission to run unverified destructive SQL, disable protective controls, fabricate official academic outcomes, or publish student secrets. Do not invent blockers.

## 2. PRODUCTION DESTINATION / DOMAIN

**Production Replit:** `lumiere-student-portal-v2`, ID `33a30f4f-b01b-4abc-a2d8-e08f31fe10d9`

**Production Supabase:** `rheronevecsffaejteoj`

**Live production hostname:** `https://lumiere-student-portal-v-2.replit.app`

**Old independent domain deployment:** `lumiereportal.app` remains attached to `MockPortalNode` pending Replit Support. THIS IS NOT A BLOCKER. Do not delay shipping, republish MockPortalNode, transfer or delete domain registration, or change the custom domain during this assignment. The new portal must work at its Replit production URL.

**Production preservation:** Existing eight production user accounts, sessions where viable, records, roles, invitation mechanics, paid feature flags, storage objects, and security policies must not be wiped/reset. Identify expected old and new code versions and take a usable DB/code backup before migrations or deployment.

## 3. DIRECT EXECUTION — NO UNNECESSARY WAITING

1. **Sync and reconcile active work.** The owner already authorized an in-flight Replit Agent task on the production Repl for owner-side AI, student workspace and preview. Determine whether that task is still working, what it actually changed, and preserve its code. Avoid overwriting concurrent work. Integrate only the good parts, account for overlapping diffs, and finish remaining features. Do not blindly revert or restart an agent close to completion.
2. **Implement the S26 requirements completely** on the authorized branch: premium owner Student Support Control Center; searchable entire student dossier; usable ticket responses; photo/document upload on both authorized sides; school roadmap/tasks/guardian/status; genuine role-specific owner and student AI; and fully navigable audited read-only View as Student covering every screen.
3. **Provide a first-student usable view in production, even before real identity is supplied.** The owner authorized using a dummy. Set up an explicitly marked **SYNTHETIC / DEMO / NOT REAL STUDENT** account/data set on production if needed for an immediately usable demonstration. Isolate it from real-student operations, real tuition/receivables, school reporting, marketing/analytics counts, official credits and external notifications. Prefer an explicitly tagged fixture protected by owner-only or QA access. Do not manufacture a real minor's identity, consent, guardian authorization, actual school enrollment, grades, payment receipts or diploma. If an isolated production QA fixture would create risk of exposure to real users, implement a secure owner-only demonstration mode using exact seeded, persistent data without cross-tenant exposure; do not block the whole release over lack of real details.
4. Use the linked complete **21-credit / 12-month illustrative plan** for this test student: all 17 core courses = 16 credits (including two 0.5-credit courses) + five unmistakably provisional elective candidates = 5 credits, 21 total and 0 school-confirmed awarded credit. The five electives are research recommendations, **not officially approved**. Label all synthetic study schedule/milestones as demonstration, not institutional policy. Do not expose the confidential awarding-school name before authorized disclosure.
5. **Build, validate, and publish production** on the existing live Replit hostname. Use the existing additive migration runner and identity guard, updated carefully if new S26 schema is needed. Run the DB pre-check and backup, apply only required safe schema changes, verify preservation of existing rows and active-account protections, then publish. Do not manually wipe production, do not use staging keys in production, and do not re-run old destructive migrations. No need to ask the owner to approve each step.
6. **Prove the release on the actual published production site** using a bounded set of smoke checks: /health, /login, /ready interpreted correctly (redis/email supplemental readiness distinguished from core health), unknown /api route JSON 404, anonymous restricted data 401, signed-in admin, owner dashboard and student search, opened synthetic student full dossier, owner View as Student all-screen read-only preview, separate synthetic student-role session, exact 21-credit plan and 0 earned credit, profile image upload/replace/reload, document upload/staff review, support ticket public reply and internal note privacy, one owner AI question answered from authorized real demo state and one student AI interaction. Confirm unauthorized cross-student/staff access is rejected.
7. If any isolated feature check fails, FIX it and redeploy as part of this assignment. No endless test rounds, generic evidence logs, or stopping after finding defects. Limit automated tests to focused TypeScript/build and sensitive authorization/file flows; use actual hosted UI at desktop and mobile widths.
8. After successful production verification, report the production URL, exact published code SHA, what is live, demonstration account access method (never credentials in public GitHub), user/operator journey, and a concise PASS / GAP / ACTUAL BLOCKER table. Finish with ownership of remaining non-blocking issues such as domain reassignment and optional shared rate limiting, without treating them as a reason to defer the portal launch.

## 4. OWNER EXPERIENCE — ACCEPTANCE MUST BE VISIBLE

From the owner's existing authenticated **Administrator** account, with no role switching or knowledge of raw UUIDs:
- Student Support Control Center with immediate access to all authorized students and actionable tickets;
- click a student to view their profile, photo, complete academic plan, subject-by-subject reported and officially verified progress, documents, guardian/contact authority, staff notes, billing status, messages, audit and graduation status;
- open a ticket directly and reply from the relevant student context; private notes never leak to student;
- ask the Lumière Owner AI contextual questions against that student's authorized records, with honest source grounding and appropriate role-based access;
- click **View as Student** and browse the exact student-facing screens (including high school, subjects, graduation, profile/photo, documents, support, any billing page, AI panel and FR/EN navigation) without signing in as the student or permitting changes;
- optionally inspect the true synthetic student's actual session in a separate isolated browser/login to ensure the preview matches.

For the synthetic student's actual authenticated session:
- attractive complete high-school dashboard, 17 mandatory courses, five visibly unapproved demo electives, 21 planned credits, 0 officially earned, relative roadmap tasks, progress reporting, French support, photo/documents, ticket creation/replies and actual safe AI help;
- uploads persist after refresh; school-issued credit, financial confirmation, institution disclosure and diploma status cannot be fabricated.

**Do not count code presence, build success or an admin redirect as a completed student or staff user journey.**

## 5. PRIORITIES AND SAFETY BOUNDARIES

Priority 1: actual owner usability + complete synthetic high-school plan in production.
Priority 2: all-screen View as Student + separate actual student account preview.
Priority 3: tickets, photos, documents and AI functional with appropriate server authorization.
Priority 4: remaining polish and non-blocking operational readiness.

Always preserve:
- production DB backups and existing records; private images/documents;
- strict student ownership and restricted staff caseload authority;
- consent and guardian scopes for minors;
- academic official-credit versus self-reported-progress separation;
- student-facing institution confidentiality;
- real-world payment processing deferred;
- role-safe actual AI; if provider unavailable, disclose that and keep the rest working;
- domain cutover is outside scope and must not delay new production hostname.

**No new owner-approval loop. No "we will test later." No unnecessary staging gate. Release the completed product directly to production, verify it and report the real result.**

## 6. EXECUTION NOTE FOR CLAUDE

Read both S26 documents referenced above in full; this addendum takes precedence on release authorization and permitted use of synthetic demo data in production. Start from branch `claude/s26-owner-and-first-student-finish` at its current head, preserve all active Replit modifications, and execute immediately. The existing S26 documents remain binding for full feature requirements, 17-course mapping, provisional elective safeguards, privacy, security, AI and upload acceptance. All other prior constraints requiring a pause before production are superseded by this explicit owner authorization.
