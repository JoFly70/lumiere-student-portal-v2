# S26 FINAL OWNER + FIRST-STUDENT COMPLETION — EXECUTE, NOT ANOTHER PLAN

Repository: JoFly70/lumiere-student-portal-v2 (PUBLIC).
Working branch: claude/s26-owner-and-first-student-finish (created from verified S26 release SHA 14a816968e56adfeb5df12fe9eed81c76cfe009f).
Production: Replit 33a30f4f-b01b-4abc-a2d8-e08f31fe10d9; Supabase rheronevecsffaejteoj.
Isolated staging: Replit 12005f5d-d31a-42c8-803c-2d0433c373f5; Supabase tqgwoyzlnkqwkcjsiocd.
Published production login: https://lumiere-student-portal-v-2.replit.app/login
Custom domain lumiereportal.app remains on MockPortalNode pending Replit Support. Do not modify that app or domain.

## OWNER ORDER
Deliver a genuinely usable complete first-student and owner experience, not another round of evidence, generic KPI shell, or empty dashboard. Review in-flight Replit production-workspace improvements first; preserve/reuse work in progress and prevent overwrite. Do not merge into main, edit real production data, or republish until owner acceptance. Create a full synthetic student only in isolated staging; do not guess the real Moroccan minor's name, birthdate, address, guardian, consent, financial terms, school approval or completion. Public Git repository must contain no identifiable student data, credentials, restricted documents, or awarding-institution name. The institution can be recorded internally in access-controlled staff records but must not leak into student-facing material until disclosure authorization.

## VERIFIED BASELINE — CODE AND PRODUCTION
Direct Supabase production read-only counts: 8 users (5 student-role, 2 admin-role, 1 staff-role), 0 students, 0 high-school enrollments, 0 support tickets and 0 documents. The owner's admin screenshot therefore shows 0 students, 0 enrollments, 0 revenue; user role does not mean linked student record.
Routes implemented: admin /admin and /admin?tab=students, student workspace /admin/students/:id, admin-only /admin/students/:id/view-as-student, admin HS /admin/students/:id/high-school, admin roadmap /admin/students/:id/roadmap, admin billing /admin/students/:id/billing, support /support; student routes /high-school, /high-school/flight-deck, /profile, /documents, /support, /billing. Different URLs on the same site DO NOT present the student experience while logged in as an administrator; student routes are role-gated.
Current View as Student is READ-ONLY but only shows Dashboard and High School, not every screen. Staff and admin support desk already has replies, attachments, internal notes, assignment and resolution, but student workspace Support tab is read-only and hides the reply in a separate Support desk. Make navigation unified and obvious.
AcademicAssistant is rendered ONLY in authenticated student layout in client/src/App.tsx. An owner-side AI is missing and must have server-side admin access, authorized student-specific context, audit and source-grounded answers. Do not simply mount student AI under admin and bypass role guards; never present canned content as a functioning live AI.
ProfileAvatarUpload exists (client/src/components/profile-avatar-upload.tsx), server validates actual file magic bytes (server/lib/profile-photo.ts), private student-documents storage and 10-minute signed URLs; client PNG/JPEG/WEBP up to 5MiB. Staff photo dialog exists. Authenticated hosted upload/persistence has not been proven.
First-student setup document docs/recovery/s22/first-student-setup.md identifies staff document upload UI missing, lead activation issues in historical build, staff search limitation and untested hosted invitation flow. Verify which defects survive S26 and fix them.
Replit production health and login published successfully, API unknown 404 and guest /api/me 401. Auth email readiness recently fixed (public sign-ups OFF) but shared Redis readiness not configured; real SMTP message delivery unproven. These do not justify another broad test campaign.

## A — COMPLETE REALISTIC SYNTHETIC STUDENT ON STAGING
Create a conspicuously tagged DEMO / SYNTHETIC / QA student: French-preferring minor from Morocco, with safely fictional identity, guardian, contact, dates and photo. Use controlled QA sign-in and role-separated authenticated student and admin sessions; do not place an invented minor in production and do not claim school enrollment occurred. Provide working distinct review URLs and screenshots of actual student view and admin workspace, including 390px mobile.
Use Standard US High School Diploma version 2, 21 CREDITS = 16 CORE + 5 ELECTIVE; use exact half-credit integer math (42 half-units total, 32 core and 10 elective). Show all 17 required core courses (two are 0.5 credits):
1. Foundations of Personal Growth, 0.5, Startup
2. Learning Success through Technology, 0.5, Startup
3. Digital Literacy, 1, Humanities
4. English 1: Introduction to Language Arts, 1
5. English 2: Foundations of Reading and Writing, 1
6. English 3: Analyzing Texts and Building Compositions, 1
7. English 4: Detailed Reading and Research Writing, 1
8. General Math 1, 1
9. Personal Finance, 1
10. General Math 2, 1
11. Earth Science, 1
12. Biology, 1
13. Physical Science, 1
14. U.S. History, 1
15. U.S. Government and Economics, 1
16. World History, 1
17. Health and Nutrition, 1
These derive from S16 template v2 and internal October 28 school research; the assigned school program has not issued individualized approval. Keep course source and pending-confirmation flags internally and avoid mentioning confidential school identity in public student content.
Five provisional DEMO electives, each 1 credit: Business Math, Microsoft Word & Excel, English Communications, Art Appreciation, Economics. Every one labeled TEST ONLY / SCHOOL APPROVAL PENDING, including Economics course-overlap concern, and absolutely zero school-confirmed credits. Do not list as real approved choices until institution confirms. No graded work or artificial official credits.
Populate a USEFUL per-course draft: human-readable overview, realistic ungraded lesson and assessment placeholders flagged as DEMO, milestones, weekly task view, planned pace schedule anchored to fictional QA start date, target and missed milestone states, honest academic progress and official-result pending status, graduation requirements 0/21 verified. Do not invent universal open-book, proctoring, test retake, 15-exam-per-week or simultaneous-course policy. Completion is self-paced and targeted, not guaranteed.
Build a trustworthy enrollment workflow covering lead -> guardian and agreement verification -> disclosure authorization -> invite/verify -> account link -> school enrollment/reference -> prior schooling evidence -> draft and selected electives -> publish roadmap -> orientation -> track tasks -> submit school evidence -> staff verify -> issue official results -> graduation clearance and issued diploma. Real school acceptance and approvals must remain pending until supported.

## B — OWNER AND STAFF CONTROL CENTER
Owner should land on a professional Student Support Control Center with clear student list, current open cases and awaiting review, student search, one-click student dossier, course-by-course academic progress, pending reports and documents, verified guardian/contacts, school enrollment stage, billing metadata (no payment processing), tickets/history, audit events, profile/portrait, and AI. Do not hide everything under KPI tabs.
Enable deep-link replies directly from the student dossier into that specific selected ticket, including PUBLIC REPLY / PRIVATE NOTE / ASSIGN / RESOLVE / ATTACH / return-to-student. Distinguish admin privilege from narrower staff/coach authorization. No cross-student data leakage.
The owner needs an audited admin-only VIEW AS STUDENT that uses real student projections and renders every actual student-facing page, not a different pretend UI: home/flight deck, My Journey, My Subjects, My Graduation, course and tasks, Profile/portrait, Documents, Support/ticket messages, Billing if relevant, Lumière AI presentation, EN/FR choice, mobile navigation and empty states. All controls inert for preview, no impersonation or state-changing side effects, logged access. For a proper hands-on student session use a separate QA student-role login in an isolated browser; never pretend admin role can open student routes.
AI for owner: same branded conversational quality as student assistant but different authorized context; read the chosen student's actual records, progress, docs, tickets and missing requirements; draft accurate support responses only with human approval; cite which records support answers; no invented grades/credit/tuition, no unapproved record writes. Use configured live model when available; otherwise HONEST unavailable indication. Student AI remains confidential and student-scoped. Owner AI may NOT use student session credentials.

## C — UPLOAD AND MEDIA ACCEPTANCE
Actual staged file roundtrip with valid photos (PNG/JPEG/WebP <=5MiB) uploaded from student and admin-authorized surfaces, followed by reload in student profile, admin workspace, owner preview. Verify replace/preview, signed URL renewal, authorization, content magic-byte validation, fake MIME, oversized/SVG/HTML rejection. Never use private signed URL in public repository.
Test student document upload, authorized STAFF upload of school evidence on student's behalf (fix absent UI), review/verify/reject, comments, private storage and download, support attachments, ticket replies with file, reload. Test one second synthetic student and cross-student refusal. Preserve safe origin and CSRF guards, no arbitrary storage-path signing.
Make portrait/photo upload prominent and reliable; show initials fallback, camera/phone behavior, accepted types, progress and clear errors, profile and student file synchronized. Browser screenshots desktop and 390px; preserve polished gold/crest design.

## D — SCOPE AND ACCEPTANCE WITHOUT ENDLESS TESTING
1. Inspect current Replit agent state and branch first; do not interrupt/overwrite uncommitted in-progress owner-side upgrades.
2. Implement in isolated branch, stage sample fixture through legitimate application services/UI and role-specific logins, NOT direct fake production inserts. Keep test fixture idempotent and clearly marked.
3. Run targeted TypeScript/build, minimal role/isolation/API and one real hosted admin+student journey. Confirm photo upload/display, document upload and staff reply; one contextual real owner AI Q&A with correct sourced data; full read-only preview navigation.
4. Produce compact audit grid across ADMIN, STUDENT, CURRICULUM, ENROLLMENT, AI, PHOTOS, DOCUMENTS, SUPPORT, GUARDIANS, BILLING, SECURITY, EMAIL and HOSTING. Mark each VERIFIED HOSTED, VERIFIED LOCAL ONLY, MISSING or DEFERRED with clear evidence boundaries. No fictitious PASS or credit.
5. Deliver actual running synthetic student account (credential handoff via private staging secret, NEVER GitHub), owner/admin direct URL, student login URL, actual studentId-specific preview URL, and screenshots. Show how owner can use them without changing account roles or trying student-only path in admin session.
6. Commit and report SHA with exactly what shipped and at most three true operational blockers. Production publish requires a quick owner review and preserves published live portal and Replit domain support ticket. No more planning-only sessions.
7. If personal student DOB, guardian, specific approved electives, school reference, fees or actual enrollment date are missing, keep those as real enrollment TODOs; do not ask the owner to repeat known facts (Morocco, French, 21/16/5, first-student pilot).

## CLAUDE EXECUTION OPTIMIZATION
Use Claude Code on this exact existing branch. Preserve active work and do not start a second independent implementation; integrate the in-flight Replit Free AI owner-side changes after reviewing them. One main engineer, at most one Sonnet subagent for bounded independent work if it reduces turnaround. Deliver the usable end-to-end PRODUCT and one honest status audit, not a giant evidence archive or indefinite new QA round. No unnecessary phase or paid model requirement.
