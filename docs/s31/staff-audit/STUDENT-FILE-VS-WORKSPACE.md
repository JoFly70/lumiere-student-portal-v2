# Student File vs Advanced Academic Workspace

## Recommendation (summary)

**Keep both. Do not merge them now.**

Apply **Option B** (labels, back link, correct deep links) in full, and **Option C** in a narrow form.

### What Option C moves into the Student File
- The Workspace's one-line **Next step** rule.
- A read-only **portal-account / guardian-pending** status line.

Each item links into the Workspace for the action itself.

### What stays in the Workspace
- Placement create, supersede and revoke.
- Guardian and identity decisions.
- Account link and unlink.

These are low-frequency, high-integrity operations that only the owner performs.

### Why not merge
A full merger (Option D) would have to:
- re-host the snapshot-fingerprint safety flow for placements;
- absorb a hidden third layout;
- translate about 600 lines of English-only UI.

It saves no measurable time for the decisions that actually recur.

---

## 1. What exists (code at `8d0d4da`)

There are **three** admin student surfaces, not two:

| Surface | URL | Component | Who can open it | Language |
|---|---|---|---|---|
| **Student File** (S27) | `/admin/students/:id` | `client/src/components/admin/file/student-file.tsx` | admin only (`client/src/App.tsx:229-235`) | EN/FR |
| **Advanced Academic Workspace** | `/admin/students/:id/workspace` | `client/src/pages/admin-student-workspace.tsx` | admin only (`App.tsx:222-228`) | EN only |
| **Older pre-S27 file** (shown *inside* `/workspace` when the student has no active degree assignment) | same URL | `client/src/components/admin/student-file-hs.tsx`, switched in at `admin-student-workspace.tsx:205-208` | admin only | EN only |

Staff can open neither the File nor the Workspace. Inside both, the `isAdmin` branches are therefore always true, so the staff code paths are dead.

Evidence screenshots (local, synthetic, FR at 1440 px):
- `screens/local-file-admin-1440-lumiere-fr.png`: the File is translated.
- `screens/local-workspace-admin-1440-lumiere-fr.png`: the Workspace is English in FR and also calls itself "Student file".

## 2. Capability inventory

Gate key: **A** = admin, **A+S** = admin + staff (server). **Both** = present in both surfaces.

### 2.1 Present in both (duplicated)

| Capability | File | Workspace | Notes |
|---|---|---|---|
| Header, status pill, demo flag | ✓ | ✓ | |
| Activate lead (`PATCH /api/admin/students/:id/status`, A) | ✓ no confirm, no toast | ✓ with toast (and a third copy in the older layout) | Three implementations (SA-25) |
| Documents review: verify, reject, request resubmit, upload on behalf (A+S server) | ✓ Documents tab | ✓ Documents tab | Same component, `StudentDocumentsReview` |
| Owner AI (A) | one-click summary + link | full panel tab | Overlap acceptable |
| Activity feed (`GET …/activity`, A) | merged into Notes & timeline | Activity tab | Same incomplete feed (SA-05) |
| Billing | **full management** | read-only summary + link to the billing page | The File wins |
| Reported (imported) records | ✓ Roadmap / Plan tab | — (HS page) | |

### 2.2 Only in the Student File

| Capability | Endpoint / gate | Frequency (assumption) |
|---|---|---|
| Agreement view and edit (dates, support months, rules, goals) | `GET` A+S, `PUT` A, `client/src/components/admin/file/agreement-dialog.tsx` | once per student, plus occasional edits |
| Checkpoints: mark done, plan a date | A, `server/routes/program-journey.ts:243,251` | monthly |
| Orientation sessions: confirm, reschedule, cancel, complete | `PATCH` A | 2 per student |
| Staff notes | A+S | weekly |
| Full billing (fee, instalments, receipts, evidence, voids) | A+S, `server/routes/admin-billing.ts` | monthly per student |
| Record school result | A+S, `server/routes/admin-high-school.ts:229-239` | per exam |
| `?tab=` deep links | — | used by Control Center, S29, S30 and AI citations |

### 2.3 Only in the Workspace (including the older layout it hosts)

| Capability | Endpoint / gate | Integrity mechanism | Audit visible in Activity? | Frequency (assumption) |
|---|---|---|---|---|
| **Placement create** | `POST /api/admin/students/:id/placements`, A (`server/routes/admin-student-credit-placement.ts:261`) | snapshot fingerprint, 409 on stale data | **No** (`target_resource_id = placementId`, SA-05) | a few per degree student, total |
| **Placement supersede / revoke** | A (`:313,374`) | same; reason required | No | rare |
| Academic report review (conflict, missing, partial evidence) | workspace payload, A | read-only | — | per transcript |
| Per-credit operator detail (source, verification, provenance) | A | read-only | — | rare |
| **Guardian & identity decisions** (identity corrections, guardian authority) | A+S (`server/routes/students.ts:302,318`) | reason, audit | **Possibly not written** (SA-05) | once per student (minors) |
| **Portal account link / unlink**, issue invitation | A (`server/routes/admin-student-account.ts:122-166`) | email equality, reason on unlink | link yes; unlink no | once per student |
| Support tickets list for the student | tickets API, `?studentId=` A | read-only | — | weekly |
| **Next-step banner** (single recommended action) | derived (`client/src/components/admin/dossier/dossier-parts.tsx:84-109`) | — | — | every visit |
| Enrollment checkpoints (8) and contract gates (7) | derived (older layout only) | — | — | onboarding |
| Change student photo | `POST /api/students/:id/photo` | — | — | once |
| Read-only "View as student" preview | A | audited | yes | occasional |

### 2.4 Navigation between them

| From → To | Today | Problem |
|---|---|---|
| File → Workspace | ghost wrench link "Academic workspace" / "Espace académique" (`student-file.tsx:143`), plus a footer note on the Degree plan tab only | Diploma and lead files give no hint that guardian, account or support live there |
| Workspace → File | **none**: only "Back to Students" (`admin-student-workspace.tsx:300`) | Dead end |
| Hash links `#workspace-profile`, `#workspace-documents` | point at `/admin/students/:id` (the File), which ignores hashes | Lands on Overview (SA-06) |
| "Open student workspace" (Add student), "Return to staff workspace" (view-as) | open the **File** | Mislabelled (SA-09) |
| Both eyebrows | "Student file" | Same name for different screens |

## 3. Options compared

Scores: ▲ better, ● neutral, ▼ worse, relative to today. Time estimates are assumptions. They are derived from click counts at about 3–5 s per click, plus about 30–60 s per wrong-page recovery.

| Criterion | A. Leave both | B. Labels, back link, deep links | C. B + move high-frequency guidance into the File | D. Full consolidation |
|---|---|---|---|---|
| **Staff task time** | ● Owner loses about 30–60 s per wrong landing (hash links, no back link) | ▲ removes the wrong landings | ▲▲ the File also tells the owner what to do next (guardian pending, account ready to link, set up program) | ▲▲ in theory; ▼ during transition |
| **Discoverability** | ▼ "Nothing is waiting on you" on new leads | ● names fixed, guidance still hidden | ▲ next step visible where the owner already is | ▲ one place, but 13+ tabs |
| **Permission integrity** | ● | ● unchanged | ● read-only facts; actions stay behind existing gates | ▼ the A-only placement and account actions must be re-gated inside a file staff may later open (SA-03) |
| **Regression risk** | none | very low (links and labels) | low (derived read-only line) | **high**: placement fingerprint flow, 409 handling, older-layout students, i18n of about 600 lines, tests and fixtures |
| **Maintenance** | ▼ two surfaces drift (four "needs attention" rules, three activation copies) | ● | ▲ one Next-step rule reused; delete the duplicate activation code | ▲ long-term one surface; ▼ short-term rewrite cost (L, about 5–8 days) |
| **Verdict** | Not acceptable: dead links | Do | **Do (selected)** | **Do not, now** |

### Why C wins
The recurring owner questions about a student are:
- What is next?
- Has the student signed up?
- Is the guardian verified?
- What documents are waiting?

Each of these is a **read**. Each is answered by data the File already loads (`useStaffProfileData`, documents, the workspace query) or by a cheap new account-state read. The **actions** behind them are rare and already live in the Workspace with their own safeguards. Moving the answers and leaving the actions gives most of the time saving at a fraction of D's risk.

### Why D loses
- Placements are performed a handful of times per degree student and are protected by a snapshot-fingerprint gate with a stale-data recovery flow (`client/src/pages/controlled-placement-workflow.ts`). Moving them gains seconds per year and risks academic-integrity regressions.
- The older pre-S27 layout means "the Workspace" is actually two layouts. A merger must reconcile three definitions of "what is waiting" and two sources of "agreement signed" (SA-26) first.
- The Workspace is English-only. Merging it means translating it, which is a cost with no workload return.
- D only becomes worthwhile if staff are given the File (SA-03) *and* staff need guardian decisions. Revisit then.

## 4. Concrete changes (Option C scope)

1. **Workspace header:**
   - eyebrow "Advanced academic workspace" (EN) / "Espace académique avancé" (FR);
   - add a "← Student file" link next to "Back to Students".
2. **Fix links:**
   - `#workspace-profile` → `/admin/students/:id/workspace#profile`;
   - `#workspace-documents` → `/admin/students/:id?tab=documents`;
   - rename "Open student workspace" to "Open student file";
   - rename "Return to staff workspace" to "Return to the student file".
3. **File Overview, "Needs a decision":** when the list would be empty, show the Workspace's `nextStep` result. Always add two derived lines, each with a link into the Workspace (or inline Link per ENROLLMENT-FRICTION-ANALYSIS):
   - "Guardian or identity decision pending (n)";
   - "Portal account: not linked / ready to link / linked".
4. **One "Activate lead" implementation**, shared by File and Workspace, with confirm and toast (SA-25).
5. **Workspace link label on the File:** "Advanced: placements, identity, account" so its content is discoverable.

**Not included:** moving placements, account link/unlink actions, guardian decision forms, or the support list.

## 5. How to prove the improvement

- **Before/after click count** for the four owner questions on a DEMO lead. Today: Overview says "nothing waiting", then wrench, then scroll; about 3–4 clicks plus one wrong landing. Target: 0 clicks (visible on Overview).
- **Playwright crawl:** every link into or out of either surface ends on the intended panel, EN and FR, 390 and 1440 px.
- **Regression:** existing placement and workspace tests (`tests/phase5c1-admin-student-credit-placement-routes.test.ts`, `tests/phase5c2-controlled-placement-ui.test.ts`, `tests/phase5a1-admin-student-workspace.test.ts`) unchanged and green; no route-gate changes.
