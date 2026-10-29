# Screen inventory (Agent A) — from client/src/App.tsx
Status: COVERED / PARTIAL / TODO / NOT VERIFIED
| Route | Guard | Component | Status |
|---|---|---|---|
| /login, /reset-password, /auth/verify, /verify-email, /resend-verification, /experience | public | Login, ResetPassword, VerifyEmail, ResendVerification, ExperiencePage | COVERED: login (1440/390 light+dark), reset-password, verify-email (failed state), resend-verification, experience (unavailable state) at 390. NOT VERIFIED: real auth emails/links, successful verify and reset flows (need real tokens) |
| / , /dashboard | any | RoleLanding (redirect) | NOT VERIFIED (redirect logic only, no visual surface) |
| /flight-deck, /assistant | student | FlightDeckRouter (+AcademicAssistant drawer) | COVERED (HS flight deck; assistant panel COVERED) |
| /high-school/flight-deck | student | HighSchoolFlightDeck | COVERED via /flight-deck (the HS student renders HS flight deck) |
| /high-school (Roadmap + Log sheet) | student | HighSchool | COVERED |
| /roadmap | student (university) | Roadmap via UniversityOnly | NOT VERIFIED (no synthetic university fixtures in repo harness) |
| /library | student | Library | COVERED |
| /documents | student | Documents | COVERED |
| /billing | student | Billing | COVERED |
| /support | any | Support (student view) | COVERED student view; staff support desk COVERED (1920/1440/768/390, dark); coach role view NOT VERIFIED (same desk component, no coach mock) |
| /profile | student | StudentProfile | COVERED |
| * | any | NotFound | COVERED |
| /admin/support-center, /staff/control-center | admin/staff | AdminSupportCenter (Control Center) | COVERED (1440/1920/1024/768/390, light+dark) |
| /admin/assistant | admin | AdminAssistant | COVERED (1440/390) |
| /admin/elective-requests | admin | AdminElectiveRequests | COVERED (1440/768/390) |
| /admin/students | admin | AdminStudents | COVERED (1920/1440/768/390, dark) |
| /admin | admin | Admin | COVERED Overview + empty states of Users/Programs/Knowledge/Audit tabs; populated data states NOT VERIFIED (no mock for those endpoints) |
| /admin/students/:id (file tabs + dialogs) | admin | AdminStudentFile | COVERED Overview/Roadmap/Documents/Billing/Notes/Sessions tabs; dialogs agreement, edit plan, record payment, adjustment, void, record result COVERED |
| /admin/students/:id/roadmap, /high-school, /billing, /workspace, /view-as-student | admin/staff | AdminStudentRoadmap etc. | high-school + billing + workspace COVERED; /roadmap (university) and view-as-student NOT VERIFIED (no synthetic AdminRoadmapState / view-as payload fixtures; pages render their designed error state) |
| /staff/billing | admin/staff | StaffBillingLookup | COVERED (empty state; search-results state NOT VERIFIED, no mock) |
| /coach-dashboard | any | redirect to /support | COVERED (redirect to /support) |
